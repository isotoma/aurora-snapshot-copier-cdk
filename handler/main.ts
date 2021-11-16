import * as AWS from 'aws-sdk';

import { allFromEnv, AuroraSnapshotSourceSelector, AuroraSnapshotSourceAggregation, AuroraSnapshotTarget, AuroraSnapshotDeletionPolicy } from './shared';
import { fromAwsTags, kmsKeyIdOrArnToId, hasKey, PickRequired } from './utils';

type RequiredSnapshotKeys = 'DBClusterSnapshotIdentifier' | 'DBClusterIdentifier' | 'DBClusterSnapshotArn' | 'SnapshotCreateTime';
type UsableSnapshot = PickRequired<AWS.RDS.Types.DBClusterSnapshot, RequiredSnapshotKeys>;

export const isUsableSnapshot = (snapshot: AWS.RDS.Types.DBClusterSnapshot): snapshot is UsableSnapshot => {
    return (
        typeof snapshot.DBClusterSnapshotIdentifier !== 'undefined' &&
        typeof snapshot.DBClusterIdentifier !== 'undefined' &&
        typeof snapshot.DBClusterSnapshotArn !== 'undefined' &&
        typeof snapshot.SnapshotCreateTime !== 'undefined'
    );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logger = (message: string, obj?: any): void => {
    console.log(
        JSON.stringify({
            message,
            ...(obj ?? {}),
        }),
    );
};

interface Snapshot {
    identifier: string;
    arn: string;
    clusterIdentifier: string;
    createdAtTime: Date;
    kmsKeyId?: string;
}

interface SnapshotForDeletion extends Snapshot {
    justRemoveTag: boolean;
}

export const snapshotFromApiMatchesSource = (source: AuroraSnapshotSourceSelector, snapshot: AWS.RDS.Types.DBClusterSnapshot): boolean => {
    // logger('Checking snapshot against source', { snapshot, source });
    // This ought to be handled by the filtering passed to the API, but this ensures no surprises.
    if (source.dbClusterIdentifier && source.dbClusterIdentifier !== snapshot.DBClusterIdentifier) {
        logger('Rejecting because cluster identifier mismatch', {
            foundDbClusterIdentifier: snapshot.DBClusterIdentifier,
            requiredDbClusterIdentifier: source.dbClusterIdentifier,
        });
        return false;
    }

    if (source.tags) {
        const snapshotTags = fromAwsTags(snapshot.TagList);
        for (const [filterTagKey, filterTagValues] of Object.entries(source.tags)) {
            const snapshotTagValue = snapshotTags[filterTagKey];
            // If the filter tag value is "true", that means we just want the tag to exist with any value
            if (filterTagValues === true) {
                if (typeof snapshotTagValue === 'undefined') {
                    logger('Rejecting because required tag is missing', {
                        snapshotTagValue,
                        filterTagKey,
                    });
                    return false;
                }
            } else if (!filterTagValues.includes(snapshotTagValue)) {
                logger('Rejecting because required tag is not in the required options', {
                    snapshotTagValue,
                    filterTagKey,
                    filterTagValues,
                });
                return false;
            }
        }
    }

    if (source.snapshotCreateTimeNotBefore) {
        const snapshotCreateTime = snapshot.SnapshotCreateTime;

        if (!snapshotCreateTime) {
            logger('Rejecting because snapshot create time not set');
            return false;
        }

        if (snapshotCreateTime.getTime() < source.snapshotCreateTimeNotBefore.getTime()) {
            logger('Rejecting because snapshot create time is too old', {
                snapshotCreateTime,
                snapshotCreateTimeNotBefore: source.snapshotCreateTimeNotBefore,
            });
            return false;
        }
    }

    if (source.snapshotType) {
        if (snapshot.SnapshotType !== source.snapshotType) {
            logger('Rejecting because snapshot type mismatch', {
                foundSnapshotType: snapshot.SnapshotType,
                requiredSnapshotType: source.snapshotType,
            });
            return false;
        }
    }

    return true;
};

export const listSnapshotsMatchingSource = async (source: AuroraSnapshotSourceSelector): Promise<Array<Snapshot>> => {
    const rds = new AWS.RDS();

    const apiParams: AWS.RDS.Types.DescribeDBClusterSnapshotsMessage = {};

    if (source.dbClusterIdentifier) {
        apiParams.DBClusterIdentifier = source.dbClusterIdentifier;
    }
    if (source.snapshotType) {
        apiParams.SnapshotType = source.snapshotType;
    }

    const response = await rds.describeDBClusterSnapshots(apiParams).promise();

    const snapshots: Array<Snapshot> = [];
    for (const snapshot of response.DBClusterSnapshots || []) {
        if (!isUsableSnapshot(snapshot)) {
            continue;
        }

        if (snapshotFromApiMatchesSource(source, snapshot)) {
            snapshots.push({
                identifier: snapshot.DBClusterSnapshotIdentifier,
                arn: snapshot.DBClusterSnapshotArn,
                clusterIdentifier: snapshot.DBClusterIdentifier,
                createdAtTime: snapshot.SnapshotCreateTime,
                kmsKeyId: snapshot.KmsKeyId ? kmsKeyIdOrArnToId(snapshot.KmsKeyId) : undefined,
            });
        }
    }

    return snapshots;
};

export const aggregateSnapshots = (snapshots: Array<Snapshot>, aggregation?: AuroraSnapshotSourceAggregation): Array<Snapshot> => {
    if (aggregation && aggregation.latestCountPerCluster) {
        const latestSnapshotsPerCluster: Record<string, SnapshotLatestQueue<Snapshot>> = {};

        for (const snapshot of snapshots) {
            const existingForCluster = latestSnapshotsPerCluster[snapshot.clusterIdentifier] ?? new SnapshotLatestQueue<Snapshot>(aggregation.latestCountPerCluster);
            existingForCluster.push(snapshot);
            latestSnapshotsPerCluster[snapshot.clusterIdentifier] = existingForCluster;
        }

        const keptSnapshots: Array<Snapshot> = [];

        for (const queue of Object.values(latestSnapshotsPerCluster)) {
            keptSnapshots.push(...queue.snapshots);
        }

        return keptSnapshots;
    }

    return snapshots;
};

interface CopySnapshotToRegionProps {
    snapshot: Snapshot;
    sourceRegion: string;
    targetRegion: string;
    sourceRegionDefaultRdsKmsKeyId?: string;
    defaultRdsKmsKeyId?: string;
    instanceIdentifier: string;
}

export const copySnapshotToRegion = async (props: CopySnapshotToRegionProps): Promise<void> => {
    const { snapshot, sourceRegion, targetRegion, sourceRegionDefaultRdsKmsKeyId, defaultRdsKmsKeyId, instanceIdentifier } = props;

    if (sourceRegion === targetRegion) {
        logger('Failed to copy snapshot to region, cannot copy to the same region', {
            snapshot,
            targetRegion,
            sourceRegion,
        });
    }

    let targetRegionKmsKeyToUse: string | undefined = undefined;

    if (snapshot.kmsKeyId && snapshot.kmsKeyId === sourceRegionDefaultRdsKmsKeyId) {
        targetRegionKmsKeyToUse = defaultRdsKmsKeyId;
    }

    logger('Compared KMS keys to determine whether this snapshot uses the default aws/rds key', {
        snapshotKmsKeyId: snapshot.kmsKeyId,
        sourceRegionDefaultRdsKmsKeyId,
        targetRegionKmsKeyToUse: targetRegionKmsKeyToUse ?? '(none)',
    });

    const rds = new AWS.RDS({
        region: targetRegion,
    });

    logger('Copying snapshot', {
        snapshot,
        sourceRegion,
        targetRegion,
        targetRegionKmsKeyToUse: targetRegionKmsKeyToUse ?? '(none)',
    });

    const targetSnapshotIdentifier = snapshot.identifier.replace(/^rds:/, '');

    try {
        await rds
            .copyDBClusterSnapshot({
                SourceDBClusterSnapshotIdentifier: snapshot.arn,
                TargetDBClusterSnapshotIdentifier: targetSnapshotIdentifier,
                CopyTags: true,
                Tags: [
                    {
                        Key: `aurora-snapshot-copier-cdk/CopiedBy/${instanceIdentifier}`,
                        Value: 'aurora-snapshot-copier-cdk',
                    },
                    {
                        Key: 'aurora-snapshot-copier-cdk/CopiedFromRegion',
                        Value: sourceRegion,
                    },
                    ...(snapshot.kmsKeyId
                        ? [
                              {
                                  Key: 'aurora-snapshot-copier-cdk/SourceRegionKmsKeyId',
                                  Value: snapshot.kmsKeyId,
                              },
                          ]
                        : []),
                ],
                ...(targetRegionKmsKeyToUse
                    ? {
                          KmsKeyId: targetRegionKmsKeyToUse,
                      }
                    : {}),
                SourceRegion: sourceRegion,
            })
            .promise();
    } catch (err) {
        if (hasKey(err, 'code') && err.code === 'DBClusterSnapshotAlreadyExistsFault') {
            logger('Snapshot already exists in the target region', {
                targetSnapshotIdentifier,
                snapshot,
            });

            const existingTargetSnapshotResponse = await rds
                .describeDBClusterSnapshots({
                    DBClusterSnapshotIdentifier: targetSnapshotIdentifier,
                })
                .promise();

            const snapshotInTargetRegion = (existingTargetSnapshotResponse.DBClusterSnapshots ?? [])[0];

            if (typeof snapshotInTargetRegion === 'undefined') {
                logger('Unable to find snapshot in target region, no matches', {
                    targetSnapshotIdentifier,
                    snapshot,
                });
                return;
            }

            const snapshotArnInTargetRegion = snapshotInTargetRegion.DBClusterSnapshotArn;

            if (typeof snapshotArnInTargetRegion === 'undefined') {
                logger('Unable to find snapshot in target region, found snapshot but has no ARN', {
                    targetSnapshotIdentifier,
                    snapshot,
                });
                return;
            }

            await rds
                .addTagsToResource({
                    ResourceName: snapshotArnInTargetRegion,
                    Tags: [
                        {
                            Key: `aurora-snapshot-copier-cdk/CopiedBy/${instanceIdentifier}`,
                            Value: 'aurora-snapshot-copier-cdk',
                        },
                    ],
                })
                .promise();
            return;
        } else {
            throw err;
        }
    }
    logger('Snapshot copy initiated', {
        snapshot,
        targetSnapshotIdentifier,
        sourceRegion,
        targetRegion,
        targetRegionKmsKeyToUse: targetRegionKmsKeyToUse ?? '(none)',
    });
};

export const getDefaultRdsKmsKeyIdForRegion = async (region: string): Promise<string | undefined> => {
    const kms = new AWS.KMS({
        region,
    });

    const aliasesResponse = await kms.listAliases({}).promise();

    for (const alias of aliasesResponse.Aliases || []) {
        if (alias.AliasName === 'alias/aws/rds') {
            return alias.TargetKeyId;
        }
    }

    // Return undefined to signify that we don't know the key ID
    return undefined;
};

export const copySnapshotsToRegion = async (snapshots: Array<Snapshot>, targetRegion: string, instanceIdentifier: string): Promise<void> => {
    const sourceRegion = process.env.AWS_REGION;

    if (!sourceRegion) {
        logger('Failed to copy snapshots, unable to determine source region from env var AWS_REGION', {
            targetRegion,
        });
        return;
    }

    const sourceRegionDefaultRdsKmsKeyId = await getDefaultRdsKmsKeyIdForRegion(sourceRegion);
    const defaultRdsKmsKeyId = await getDefaultRdsKmsKeyIdForRegion(targetRegion);

    const promises = [];
    for (const snapshot of snapshots) {
        promises.push(
            copySnapshotToRegion({
                snapshot,
                sourceRegion,
                targetRegion,
                sourceRegionDefaultRdsKmsKeyId,
                defaultRdsKmsKeyId,
                instanceIdentifier,
            }),
        );
    }

    await Promise.all(promises).then(() => {
        // Return void, not an array of void
    });
};

export class SnapshotLatestQueue<T extends Snapshot> {
    readonly snapshots: Array<T>;
    readonly maxSize: number;

    constructor(maxSize: number) {
        if (maxSize < 1) {
            throw new Error('maxSize must be at least 1');
        }
        this.maxSize = maxSize;
        // Snapshots, with the most recent at the front
        this.snapshots = [];
    }

    // Push a new snapshot into the queue. Return the oldest snapshot
    // which may have been pushed out of the queue to make space, or
    // the snapshot that was passed in if there is no space for it in
    // the queue and it is older than all those already there.
    push(snapshot: T): T | undefined {
        let insertAtIndex: number | undefined = undefined;
        for (let i = 0; i < this.maxSize; ++i) {
            const compareSnapshot = this.snapshots[i];
            if (typeof compareSnapshot === 'undefined') {
                break;
            }

            if (compareSnapshot.createdAtTime.getTime() < snapshot.createdAtTime.getTime()) {
                insertAtIndex = i;
                break;
            }
        }

        if (typeof insertAtIndex === 'undefined') {
            if (this.snapshots.length < this.maxSize) {
                this.snapshots.push(snapshot);
                return undefined;
            }
            return snapshot;
        }

        this.snapshots.splice(insertAtIndex, 0, snapshot);

        if (this.snapshots.length > this.maxSize) {
            return this.snapshots.pop();
        }

        return undefined;
    }
}

export const filterSnapshotsForDeletionPolicy = (deletionPolicy: AuroraSnapshotDeletionPolicy, snapshots: Array<SnapshotForDeletion>): Array<SnapshotForDeletion> => {
    const snapshotsNotForSavingPerCluster: Array<SnapshotForDeletion> = [];

    const snapshotsToSavePerCluster: Record<string, SnapshotLatestQueue<SnapshotForDeletion>> = {};

    for (const snapshot of snapshots) {
        if (deletionPolicy.keepLatestCountPerDbClusterIdentifier) {
            const existingSaved = snapshotsToSavePerCluster[snapshot.clusterIdentifier] ?? new SnapshotLatestQueue<SnapshotForDeletion>(deletionPolicy.keepLatestCountPerDbClusterIdentifier);
            snapshotsToSavePerCluster[snapshot.clusterIdentifier] = existingSaved;

            const popped = existingSaved.push(snapshot);

            if (popped) {
                snapshotsNotForSavingPerCluster.push(popped);
            }
        } else {
            snapshotsNotForSavingPerCluster.push(snapshot);
        }
    }

    const saved: Record<string, Array<string>> = {};
    for (const [clusterIdentifier, queue] of Object.entries(snapshotsToSavePerCluster)) {
        saved[clusterIdentifier] = queue.snapshots.map((snapshot) => snapshot.identifier);
    }

    logger('Snapshots marked safe per cluster', {
        saved,
        keepLatestCountPerDbClusterIdentifier: deletionPolicy.keepLatestCountPerDbClusterIdentifier,
    });

    logger('Snapshots still considering for deletion', {
        count: snapshotsNotForSavingPerCluster.length,
    });

    const now = new Date();

    const snapshotsToDelete: Array<SnapshotForDeletion> = [];

    if (typeof deletionPolicy.keepCreatedInTheLastSeconds !== 'undefined') {
        for (const snapshot of snapshotsNotForSavingPerCluster) {
            if (snapshot.createdAtTime.getTime() < now.getTime() - deletionPolicy.keepCreatedInTheLastSeconds * 1000) {
                snapshotsToDelete.push(snapshot);
            }
        }
        return snapshotsToDelete;
    }

    return snapshotsNotForSavingPerCluster;
};

export const handleSnapshotDeletion = async (deletionPolicy: AuroraSnapshotDeletionPolicy | undefined, region: string, instanceIdentifier: string): Promise<void> => {
    if (typeof deletionPolicy === 'undefined') {
        logger('No deletion policy, nothing to do');
        return;
    }

    logger('Handling deletion policy', {
        deletionPolicy,
        region,
    });

    const rds = new AWS.RDS({
        region,
    });

    const snapshots: Array<SnapshotForDeletion> = [];

    const response = await rds.describeDBClusterSnapshots({}).promise();

    for (const snapshot of response.DBClusterSnapshots || []) {
        if (!isUsableSnapshot(snapshot)) {
            continue;
        }

        const tags = fromAwsTags(snapshot.TagList);

        let copiedByOtherInstance = false;
        let copiedByThisInstance = false;

        for (const [key, value] of Object.entries(tags)) {
            if (key === `aurora-snapshot-copier-cdk/CopiedBy/${instanceIdentifier}` && value === 'aurora-snapshot-copier-cdk') {
                copiedByThisInstance = true;
            } else if (key.startsWith('aurora-snapshot-copier-cdk/CopiedBy/')) {
                copiedByOtherInstance = true;
            }
        }

        if (!copiedByThisInstance) {
            continue;
        }

        snapshots.push({
            identifier: snapshot.DBClusterSnapshotIdentifier,
            arn: snapshot.DBClusterSnapshotArn,
            clusterIdentifier: snapshot.DBClusterIdentifier,
            createdAtTime: snapshot.SnapshotCreateTime,
            justRemoveTag: copiedByOtherInstance,
        });
    }

    logger('Found snapshots for deletion consideration', {
        count: snapshots.length,
    });

    const snapshotsToDelete = filterSnapshotsForDeletionPolicy(deletionPolicy, snapshots);

    const deleteSnapshot = async (snapshot: SnapshotForDeletion): Promise<void> => {
        const deleteParams = {
            DBClusterSnapshotIdentifier: snapshot.identifier,
        };
        if (snapshot.justRemoveTag) {
            await rds
                .removeTagsFromResource({
                    ResourceName: snapshot.arn,
                    TagKeys: [`aurora-snapshot-copier-cdk/CopiedBy/${instanceIdentifier}`],
                })
                .promise();
            return;
        }
        if (deletionPolicy.apply) {
            logger('Deleting snapshot', {
                region,
                identifier: snapshot.identifier,
                apiCall: 'rds.deleteDBClusterSnapshot',
                params: deleteParams,
            });
            await rds.deleteDBClusterSnapshot(deleteParams).promise();
        } else {
            logger('Dry-run, marking snapshot as would-have-deleted', {
                region,
                identifier: snapshot.identifier,
                dryRun: {
                    apiCall: 'rds.deleteDBClusterSnapshot',
                    params: deleteParams,
                },
            });
            await rds
                .addTagsToResource({
                    ResourceName: snapshot.arn,
                    Tags: [
                        {
                            Key: 'aurora-snapshot-copier-cdk/DryRunDeletedAt',
                            Value: new Date().toISOString(),
                        },
                    ],
                })
                .promise();
        }
    };

    await Promise.all(snapshotsToDelete.map(deleteSnapshot));
};

export const copySnapshots = async (snapshots: Array<Snapshot>, target: AuroraSnapshotTarget, instanceIdentifier: string): Promise<void> => {
    const promises = [];
    for (const region of target.regions) {
        promises.push(copySnapshotsToRegion(snapshots, region, instanceIdentifier));
    }
    return Promise.all(promises).then(() => {
        // Return void, not an array of void
    });
};

export const deleteSnapshots = async (snapshots: Array<Snapshot>, target: AuroraSnapshotTarget, instanceIdentifier: string): Promise<void> => {
    const promises = [];
    for (const region of target.regions) {
        promises.push(handleSnapshotDeletion(target.deletionPolicy, region, instanceIdentifier));
    }
    return Promise.all(promises).then(() => {
        // Return void, not an array of void
    });
};

export const handler = async () => {
    logger('Starting');

    const options = allFromEnv(process.env);

    logger('Found options', { options });

    const snapshotsPromises: Array<Promise<Array<Snapshot>>> = [];

    for (const source of options.sources) {
        snapshotsPromises.push(listSnapshotsMatchingSource(source));
    }

    const snapshots: Array<Snapshot> = [];

    for (const snapshotsForSource of await Promise.all(snapshotsPromises)) {
        snapshots.push(...snapshotsForSource);
    }

    const aggregatedSnapshots = aggregateSnapshots(snapshots, options.aggregation);

    logger('Snapshots to copy', { aggregatedSnapshots });

    await copySnapshots(aggregatedSnapshots, options.target, options.instanceIdentifier);
    await deleteSnapshots(aggregatedSnapshots, options.target, options.instanceIdentifier);
};
