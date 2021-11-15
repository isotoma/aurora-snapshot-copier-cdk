import * as AWS from 'aws-sdk';
import * as AWSMock from 'aws-sdk-mock';
import * as sinon from 'sinon';

import * as handlerMain from '../handler/main';
import * as shared from '../handler/shared';

const HOUR_IN_MILLIS = 60 * 60 * 1000;
const HOUR_IN_SECONDS = 60 * 60;

describe('listSnapshotsMatchingSource', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...OLD_ENV,
            AWS_REGION: 'eu-west-2',
            AWS_DEFAULT_REGION: 'eu-west-2',
        };
    });

    afterEach(() => {
        AWSMock.restore();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    test('simple', async () => {
        const source = {
            dbClusterIdentifier: 'mysourcedbclusteridentifier',
        };

        AWSMock.setSDKInstance(AWS);

        const describeDBClusterSnapshotsSpy = sinon.spy((params, cb) => {
            cb(null, {
                DBClusterSnapshots: [
                    {
                        DBClusterSnapshotIdentifier: 'mysnapshot',
                        DBClusterSnapshotArn: 'mysnapshotarn',
                        DBClusterIdentifier: 'mysourcedbclusteridentifier',
                        SnapshotCreateTime: new Date('2021-07-01'),
                    },
                ],
            });
        });

        // GIVEN
        AWSMock.mock('RDS', 'describeDBClusterSnapshots', describeDBClusterSnapshotsSpy);

        // WHEN
        const snapshots = await handlerMain.listSnapshotsMatchingSource(source);

        expect(snapshots).toEqual([
            {
                identifier: 'mysnapshot',
                arn: 'mysnapshotarn',
                clusterIdentifier: 'mysourcedbclusteridentifier',
                createdAtTime: new Date('2021-07-01'),
                kmsKeyId: undefined,
            },
        ]);

        // THEN
        expect(describeDBClusterSnapshotsSpy.called).toBe(true);
    });
});

describe('SnapshotLatestQueue', () => {
    const oldest = {
        identifier: 'oldest',
        arn: 'oldest',
        clusterIdentifier: 'cluster',
        createdAtTime: new Date('2021-01-01'),
    };

    const older = {
        identifier: 'older',
        arn: 'older',
        clusterIdentifier: 'cluster',
        createdAtTime: new Date('2021-02-01'),
    };

    const old = {
        identifier: 'old',
        arn: 'old',
        clusterIdentifier: 'cluster',
        createdAtTime: new Date('2021-03-01'),
    };

    const newer = {
        identifier: 'newer',
        arn: 'newer',
        clusterIdentifier: 'cluster',
        createdAtTime: new Date('2021-04-01'),
    };

    const newest = {
        identifier: 'newest',
        arn: 'newest',
        clusterIdentifier: 'cluster',
        createdAtTime: new Date('2021-05-01'),
    };

    test('push into empty', () => {
        const queue = new handlerMain.SnapshotLatestQueue(5);
        const popped = queue.push(oldest);

        expect(queue.snapshots).toEqual([oldest]);
        expect(popped).toEqual(undefined);
    });

    test('push newer into full', () => {
        const queue = new handlerMain.SnapshotLatestQueue(1);
        queue.push(older);
        const popped = queue.push(newer);

        expect(queue.snapshots).toEqual([newer]);
        expect(popped).toEqual(older);
    });

    test('push older into full', () => {
        const queue = new handlerMain.SnapshotLatestQueue(1);
        queue.push(newer);
        const popped = queue.push(older);

        expect(queue.snapshots).toEqual([newer]);
        expect(popped).toEqual(older);
    });

    test('multiple push and pops', () => {
        const queue = new handlerMain.SnapshotLatestQueue(3);
        expect(queue.push(oldest)).toEqual(undefined);
        expect(queue.push(older)).toEqual(undefined);
        expect(queue.push(old)).toEqual(undefined);
        expect(queue.push(newer)).toEqual(oldest);
        expect(queue.push(newest)).toEqual(older);

        expect(queue.snapshots).toEqual([newest, newer, old]);
    });
});

describe('aggregateSnapshots', () => {
    const olderA = {
        identifier: 'olderA',
        arn: 'olderA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-01-01'),
    };

    const oldA = {
        identifier: 'oldA',
        arn: 'oldA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-02-01'),
    };

    const newerA = {
        identifier: 'newerA',
        arn: 'newerA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-03-01'),
    };

    const olderB = {
        identifier: 'olderB',
        arn: 'olderB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-01-01'),
    };

    const oldB = {
        identifier: 'oldB',
        arn: 'oldB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-02-01'),
    };

    const newerB = {
        identifier: 'newerB',
        arn: 'newerB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-03-01'),
    };

    test('no aggregation', () => {
        expect(handlerMain.aggregateSnapshots([oldA, oldB], {})).toEqual([oldA, oldB]);
    });

    test('2 per cluster', () => {
        const aggregated = handlerMain.aggregateSnapshots([olderA, newerA, oldB, newerB, olderB, oldA], {
            latestCountPerCluster: 2,
        });
        expect(aggregated.length).toEqual(4);
        expect(aggregated).toEqual(expect.arrayContaining([newerA, newerB, oldA, oldB]));
    });

    test('2 per cluster, handles fewer per cluster than the limit', () => {
        // Only 1 for A
        const aggregated = handlerMain.aggregateSnapshots([olderA, oldB, newerB, olderB], {
            latestCountPerCluster: 2,
        });
        expect(aggregated.length).toEqual(3);
        expect(aggregated).toEqual(expect.arrayContaining([olderA, newerB, oldB]));
    });
});

describe('filterSnapshotsForDeletionPolicy', () => {
    const olderA = {
        identifier: 'olderA',
        arn: 'olderA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-01-01'),
    };

    const oldA = {
        identifier: 'oldA',
        arn: 'oldA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-02-01'),
    };

    const newerA = {
        identifier: 'newerA',
        arn: 'newerA',
        clusterIdentifier: 'A',
        createdAtTime: new Date('2021-03-01'),
    };

    const olderB = {
        identifier: 'olderB',
        arn: 'olderB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-01-01'),
    };

    const oldB = {
        identifier: 'oldB',
        arn: 'oldB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-02-01'),
    };

    const newerB = {
        identifier: 'newerB',
        arn: 'newerB',
        clusterIdentifier: 'B',
        createdAtTime: new Date('2021-03-01'),
    };

    test('deletion policy latest count per cluster', () => {
        const filtered = handlerMain.filterSnapshotsForDeletionPolicy(
            {
                keepLatestCountPerDbClusterIdentifier: 2,
            },
            [olderA, newerB, oldA, newerA, olderB, oldB],
        );
        // 6 in total, 2 per cluster = 4, to be saved, leaving 2 oldest to be deleted
        expect(filtered.length).toEqual(2);
        expect(filtered).toEqual(expect.arrayContaining([olderA, olderB]));
    });
});

describe('isUsableSnapshot', () => {
    test('is', () => {
        expect(
            handlerMain.isUsableSnapshot({
                DBClusterSnapshotIdentifier: 'foo',
                DBClusterIdentifier: 'bar',
                DBClusterSnapshotArn: 'baz',
                SnapshotCreateTime: new Date(),
            }),
        ).toEqual(true);
    });

    test('is not, missing snapshot identifier', () => {
        expect(
            handlerMain.isUsableSnapshot({
                DBClusterIdentifier: 'bar',
                DBClusterSnapshotArn: 'baz',
                SnapshotCreateTime: new Date(),
            }),
        ).toEqual(false);
    });

    test('is not, missing cluster identifier', () => {
        expect(
            handlerMain.isUsableSnapshot({
                DBClusterSnapshotIdentifier: 'foo',
                DBClusterSnapshotArn: 'baz',
                SnapshotCreateTime: new Date(),
            }),
        ).toEqual(false);
    });

    test('is not, missing snapshot arn', () => {
        expect(
            handlerMain.isUsableSnapshot({
                DBClusterSnapshotIdentifier: 'foo',
                DBClusterIdentifier: 'bar',
                SnapshotCreateTime: new Date(),
            }),
        ).toEqual(false);
    });

    test('is not, missing create time', () => {
        expect(
            handlerMain.isUsableSnapshot({
                DBClusterSnapshotIdentifier: 'foo',
                DBClusterIdentifier: 'bar',
                DBClusterSnapshotArn: 'baz',
            }),
        ).toEqual(false);
    });
});

describe('snapshotFromApiMatchesSource', () => {
    test('cluster identifier mismatch', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    dbClusterIdentifier: 'mycluster',
                },
                {
                    DBClusterIdentifier: 'NOTmycluster',
                },
            ),
        ).toEqual(false);
    });

    test('tag value does not match', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    tags: {
                        mytag: ['tagvalue'],
                    },
                },
                {
                    TagList: [
                        {
                            Key: 'mytag',
                            Value: 'NOTtagvalue',
                        },
                    ],
                },
            ),
        ).toEqual(false);
    });

    test('required tag missing', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    tags: {
                        mytag: true,
                    },
                },
                {
                    TagList: [
                        {
                            Key: 'NOTmytag',
                            Value: 'NOTtagvalue',
                        },
                    ],
                },
            ),
        ).toEqual(false);
    });

    test('too old', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    snapshotCreateTimeNotBefore: new Date('2021-01-01'),
                },
                {
                    SnapshotCreateTime: new Date('2020-01-01'),
                },
            ),
        ).toEqual(false);
    });

    test('missing snapshot create time', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    snapshotCreateTimeNotBefore: new Date('2021-01-01'),
                },
                {
                    SnapshotCreateTime: undefined,
                },
            ),
        ).toEqual(false);
    });

    test('type mismatch', () => {
        expect(
            handlerMain.snapshotFromApiMatchesSource(
                {
                    snapshotType: 'sometype',
                },
                {
                    SnapshotType: 'NOTsometime',
                },
            ),
        ).toEqual(false);
    });
});

describe('copySnapshotToRegion', () => {
    test('simple', async () => {
        // GIVEN
        AWSMock.setSDKInstance(AWS);

        const copyDBClusterSnapshotSpy = sinon.spy((params, cb) => {
            cb(null, {});
        });

        AWSMock.mock('RDS', 'copyDBClusterSnapshot', copyDBClusterSnapshotSpy);

        // WHEN
        await handlerMain.copySnapshotToRegion({
            snapshot: {
                identifier: 'myidentifier',
                arn: 'myarn',
                clusterIdentifier: 'mycluster',
                createdAtTime: new Date('2021-01-01'),
            },
            sourceRegion: 'eu-west-1',
            targetRegion: 'eu-west-2',
        });

        // THEN
        const rdsConstructorSpy = AWS.RDS as unknown as sinon.SinonSpy;
        expect(rdsConstructorSpy.getCall(0).args[0]).toEqual({
            region: 'eu-west-2',
        });

        expect(copyDBClusterSnapshotSpy.callCount).toEqual(1);
        const params = copyDBClusterSnapshotSpy.getCall(0).args[0];
        expect(params).toEqual({
            CopyTags: true,
            SourceDBClusterSnapshotIdentifier: 'myarn',
            SourceRegion: 'eu-west-1',

            Tags: [
                {
                    Key: 'aurora-snapshot-copier-cdk/CopiedBy',
                    Value: 'aurora-snapshot-copier-cdk',
                },
                {
                    Key: 'aurora-snapshot-copier-cdk/CopiedFromRegion',
                    Value: 'eu-west-1',
                },
            ],
            TargetDBClusterSnapshotIdentifier: 'myidentifier',
        });
    });
});

describe('getDefaultRdsKmsKeyIdForRegion', () => {
    afterEach(() => {
        AWSMock.restore();
    });

    test('found', async () => {
        // GIVEN
        AWSMock.setSDKInstance(AWS);

        const listAliasesSpy = sinon.spy((params, cb) => {
            cb(null, {
                Aliases: [
                    {
                        AliasName: 'not this one',
                        TargetKeyId: 'someid',
                    },
                    {
                        AliasName: 'alias/aws/rds',
                        TargetKeyId: 'correctid',
                    },
                ],
            });
        });

        AWSMock.mock('KMS', 'listAliases', listAliasesSpy);

        // WHEN
        const keyId = await handlerMain.getDefaultRdsKmsKeyIdForRegion('eu-west-1');

        // THEN
        expect(keyId).toEqual('correctid');

        const kmsConstructorSpy = AWS.KMS as unknown as sinon.SinonSpy;
        expect(kmsConstructorSpy.getCall(0).args[0]).toEqual({
            region: 'eu-west-1',
        });

        expect(listAliasesSpy.callCount).toEqual(1);
    });

    test('not found', async () => {
        // GIVEN
        AWSMock.setSDKInstance(AWS);

        const listAliasesSpy = sinon.spy((params, cb) => {
            cb(null, {
                Aliases: [
                    {
                        AliasName: 'not this one',
                        TargetKeyId: 'someid',
                    },
                    {
                        AliasName: 'not this one either',
                        TargetKeyId: 'someotherid',
                    },
                ],
            });
        });

        AWSMock.mock('KMS', 'listAliases', listAliasesSpy);

        // WHEN
        const keyId = await handlerMain.getDefaultRdsKmsKeyIdForRegion('eu-west-1');

        // THEN
        expect(keyId).toEqual(undefined);

        const kmsConstructorSpy = AWS.KMS as unknown as sinon.SinonSpy;
        expect(kmsConstructorSpy.getCall(0).args[0]).toEqual({
            region: 'eu-west-1',
        });

        expect(listAliasesSpy.callCount).toEqual(1);
    });
});

describe('copySnapshotsToRegion', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...OLD_ENV,
            AWS_REGION: 'eu-west-2',
            AWS_DEFAULT_REGION: 'eu-west-2',
        };
    });

    afterEach(() => {
        AWSMock.restore();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    test('two', async () => {
        // GIVEN
        AWSMock.setSDKInstance(AWS);

        const copyDBClusterSnapshotSpy = sinon.spy((params, cb) => {
            cb(null, {});
        });

        AWSMock.mock('RDS', 'copyDBClusterSnapshot', copyDBClusterSnapshotSpy);

        const listAliasesSpy = sinon.spy((params, cb) => {
            cb(null, {});
        });

        AWSMock.mock('KMS', 'listAliases', listAliasesSpy);

        // WHEN
        await handlerMain.copySnapshotsToRegion(
            [
                {
                    identifier: 'myidentifier',
                    arn: 'myarn',
                    clusterIdentifier: 'mycluster',
                    createdAtTime: new Date('2021-01-01'),
                },
                {
                    identifier: 'myidentifier2',
                    arn: 'myarn2',
                    clusterIdentifier: 'mycluster2',
                    createdAtTime: new Date('2021-01-01'),
                },
            ],
            'eu-west-1',
            undefined,
        );

        expect(copyDBClusterSnapshotSpy.callCount).toEqual(2);
        expect(listAliasesSpy.callCount).toEqual(2);

        const kmsConstructorSpy = AWS.KMS as unknown as sinon.SinonSpy;
        const constructorApiRegions = new Set([kmsConstructorSpy.getCall(0).args[0].region, kmsConstructorSpy.getCall(1).args[0].region]);
        expect(constructorApiRegions).toEqual(new Set(['eu-west-1', 'eu-west-2']));
    });
});

describe('handleSnapshotDeletion', () => {
    test('simple', async () => {
        const deleteDBClusterSnapshotSpy = sinon.spy((params, cb) => {
            cb(null, {});
        });

        AWSMock.mock('RDS', 'deleteDBClusterSnapshot', deleteDBClusterSnapshotSpy);

        const describeDBClusterSnapshotsSpy = sinon.spy((params, cb) => {
            cb(null, {
                DBClusterSnapshots: [
                    {
                        DBClusterSnapshotIdentifier: 'mysnapshot',
                        DBClusterSnapshotArn: 'mysnapshotarn',
                        DBClusterIdentifier: 'mysourcedbclusteridentifier',
                        SnapshotCreateTime: new Date(new Date().getTime() - 24 * HOUR_IN_MILLIS),
                        TagList: [
                            {
                                Key: 'aurora-snapshot-copier-cdk/CopiedBy',
                                Value: 'aurora-snapshot-copier-cdk',
                            },
                        ],
                    },
                ],
            });
        });

        AWSMock.mock('RDS', 'describeDBClusterSnapshots', describeDBClusterSnapshotsSpy);

        await handlerMain.handleSnapshotDeletion(
            {
                keepCreatedInTheLastSeconds: 23 * HOUR_IN_SECONDS,
                apply: true,
            },
            'eu-west-2',
            undefined,
        );

        expect(deleteDBClusterSnapshotSpy.callCount).toEqual(1);
    });
});

describe('copySnapshots', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('simple', async () => {
        const mockCopySnapshotsToRegion = sinon.spy(async () => {
            return Promise.resolve();
        });

        jest.spyOn(handlerMain, 'copySnapshotsToRegion').mockImplementation(mockCopySnapshotsToRegion);

        await handlerMain.copySnapshots(
            [
                {
                    identifier: 'myidentifier',
                    arn: 'myarn',
                    clusterIdentifier: 'mycluster',
                    createdAtTime: new Date('2021-01-01'),
                },
            ],
            {
                regions: ['eu-west-1', 'eu-west-2'],
            },
            undefined,
        );

        expect(mockCopySnapshotsToRegion.callCount).toEqual(2);
    });
});

describe('deleteSnapshots', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('simple', async () => {
        const mockHandleSnapshotDeletion = sinon.spy(async () => {
            return Promise.resolve();
        });

        jest.spyOn(handlerMain, 'handleSnapshotDeletion').mockImplementation(mockHandleSnapshotDeletion);

        await handlerMain.deleteSnapshots(
            [
                {
                    identifier: 'myidentifier',
                    arn: 'myarn',
                    clusterIdentifier: 'mycluster',
                    createdAtTime: new Date('2021-01-01'),
                },
            ],
            {
                regions: ['eu-west-1', 'eu-west-2'],
            },
            undefined,
        );

        expect(mockHandleSnapshotDeletion.callCount).toEqual(2);
    });
});

describe('handler', () => {
    test('simple', async () => {
        const mockAllFromEnv = sinon.spy(() => ({
            sources: [
                {
                    dbClusterIdentifier: 'myidentifier',
                },
            ],
            target: {
                regions: ['eu-west-1'],
            },
        }));

        jest.spyOn(shared, 'allFromEnv').mockImplementation(mockAllFromEnv);

        const mySnapshot = {
            identifier: 'mysnapshotidentifier',
            arn: 'mysnapshotidentifier',
            clusterIdentifier: 'myidentifier',
            createdAtTime: new Date('2021-01-01'),
        };

        const mockListSnapshotsMatchingSource = sinon.spy(() => {
            return Promise.resolve([mySnapshot]);
        });
        jest.spyOn(handlerMain, 'listSnapshotsMatchingSource').mockImplementation(mockListSnapshotsMatchingSource);

        const mockAggregateSnapshots = sinon.spy((snapshots) => snapshots);
        jest.spyOn(handlerMain, 'aggregateSnapshots').mockImplementation(mockAggregateSnapshots);

        const mockCopySnapshots = sinon.spy(() => Promise.resolve());
        jest.spyOn(handlerMain, 'copySnapshots').mockImplementation(mockCopySnapshots);

        const mockDeleteSnapshots = sinon.spy(() => Promise.resolve());
        jest.spyOn(handlerMain, 'deleteSnapshots').mockImplementation(mockDeleteSnapshots);

        // WHEN
        await handlerMain.handler();

        expect(mockAllFromEnv.callCount).toEqual(1);
        expect(mockListSnapshotsMatchingSource.callCount).toEqual(1);
        expect(mockAggregateSnapshots.callCount).toEqual(1);
        expect(mockCopySnapshots.callCount).toEqual(1);
        expect(mockDeleteSnapshots.callCount).toEqual(1);

        expect(mockCopySnapshots.getCall(0).args).toEqual([
            [mySnapshot],
            {
                regions: ['eu-west-1'],
            },
            undefined,
        ]);
    });
});
