import { isArrayOfStrings } from './utils';

export interface AuroraSnapshotSourceSelector {
    dbClusterIdentifier?: string;
    tags?: Record<string, Array<string> | true>;
    snapshotCreateTimeNotBefore?: Date;
    snapshotType?: string;
}

export interface AuroraSnapshotSourceAggregation {
    latestCountPerCluster?: number;
}

export interface AuroraSnapshotDeletionPolicy {
    keepLatestCountPerDbClusterIdentifier?: number;
    keepCreatedInTheLastSeconds?: number;
    apply?: boolean;
}

export interface AuroraSnapshotTarget {
    regions: Array<string>;
    deletionPolicy?: AuroraSnapshotDeletionPolicy;
}

export interface AuroraSnapshotHandlerOptions {
    sources: Array<AuroraSnapshotSourceSelector>;
    aggregation?: AuroraSnapshotSourceAggregation;
    target: AuroraSnapshotTarget;
    instanceIdentifier?: string;
}

export const toEnv = (source: AuroraSnapshotSourceSelector, index: number): Record<string, string> => {
    const env: Record<string, string> = {};

    if (source.dbClusterIdentifier) {
        env[`SOURCE_${index}_DB_CLUSTER_IDENTIFIER`] = source.dbClusterIdentifier;
    }
    if (source.tags) {
        env[`SOURCE_${index}_TAGS`] = JSON.stringify(source.tags);
    }
    if (source.snapshotCreateTimeNotBefore) {
        env[`SOURCE_${index}_SNAPSHOT_CREATE_TIME_NOT_BEFORE`] = source.snapshotCreateTimeNotBefore.toISOString();
    }
    if (source.snapshotType) {
        env[`SOURCE_${index}_SNAPSHOT_TYPE`] = source.snapshotType;
    }

    return env;
};

export const fromEnv = (env: Record<string, string | undefined>, index: number): AuroraSnapshotSourceSelector | undefined => {
    const rawDbClusterIdentifier = env[`SOURCE_${index}_DB_CLUSTER_IDENTIFIER`];
    const rawTags = env[`SOURCE_${index}_TAGS`];
    const rawSnapshotCreateTimeNotBefore = env[`SOURCE_${index}_SNAPSHOT_CREATE_TIME_NOT_BEFORE`];
    const rawSnapshotType = env[`SOURCE_${index}_SNAPSHOT_TYPE`];

    const source: AuroraSnapshotSourceSelector = {};

    if (typeof rawDbClusterIdentifier === 'string') {
        source.dbClusterIdentifier = rawDbClusterIdentifier;
    }
    if (typeof rawTags === 'string') {
        let parsedTags: unknown = undefined;
        try {
            parsedTags = JSON.parse(rawTags);
        } catch (err) {
            console.error('Error reading tags as JSON');
        }

        if (parsedTags && typeof parsedTags === 'object') {
            const validatedTags: Record<string, Array<string> | true> = {};
            for (const [tagName, tagValues] of Object.entries(parsedTags)) {
                if (typeof tagName === 'string') {
                    if (isArrayOfStrings(tagValues)) {
                        validatedTags[tagName] = tagValues;
                    } else if (tagValues === true) {
                        validatedTags[tagName] = true;
                    }
                }
            }

            if (Object.keys(validatedTags).length) {
                source.tags = validatedTags;
            }
        } else {
            console.error('Unexpected shape of parsed JSON for tags');
        }
    }

    if (typeof rawSnapshotCreateTimeNotBefore === 'string') {
        source.snapshotCreateTimeNotBefore = new Date(rawSnapshotCreateTimeNotBefore);
    }

    if (typeof rawSnapshotType === 'string') {
        source.snapshotType = rawSnapshotType;
    }

    if (Object.keys(source).length === 0) {
        return undefined;
    }

    return source;
};

export const allToEnv = (options: AuroraSnapshotHandlerOptions): Record<string, string> => {
    const envParts: Array<Record<string, string>> = [];

    let index = 0;
    for (const source of options.sources) {
        envParts.push(toEnv(source, index));
        index++;
    }

    const env = Object.assign({}, ...envParts);

    if (options.aggregation) {
        if (typeof options.aggregation.latestCountPerCluster !== 'undefined') {
            env['AGGREGATION_LATEST_COUNT_PER_CLUSTER'] = `${options.aggregation.latestCountPerCluster}`;
        }
    }

    const deletionPolicy = options.target.deletionPolicy;
    if (deletionPolicy) {
        if (typeof deletionPolicy.keepLatestCountPerDbClusterIdentifier !== 'undefined') {
            env['TARGET_DELETION_POLICY_KEEP_LATEST_COUNT_PER_DB_CLUSTER_IDENTIFIER'] = `${deletionPolicy.keepLatestCountPerDbClusterIdentifier}`;
        }
        if (typeof deletionPolicy.keepCreatedInTheLastSeconds !== 'undefined') {
            env['TARGET_DELETION_POLICY_KEEP_CREATED_IN_THE_LAST_SECONDS'] = `${deletionPolicy.keepCreatedInTheLastSeconds}`;
        }
        if (typeof deletionPolicy.apply !== 'undefined') {
            env['TARGET_DELETION_POLICY_APPLY'] = deletionPolicy.apply ? '1' : '';
        }
    }

    env['TARGET_REGIONS'] = options.target.regions.join(',');

    return env;
};

export const allFromEnv = (env: Record<string, string | undefined>): AuroraSnapshotHandlerOptions => {
    const sources: Array<AuroraSnapshotSourceSelector> = [];

    let index = 0;
    while (true) {
        const source = fromEnv(env, index);
        if (typeof source === 'undefined') {
            break;
        }
        sources.push(source);
        index++;
    }

    const target: AuroraSnapshotTarget = {
        regions: env['TARGET_REGIONS'] ? env['TARGET_REGIONS'].split(',') : [],
    };

    let deletionPolicyNotEmpty = false;
    const deletionPolicy: AuroraSnapshotDeletionPolicy = {};
    const rawTargetDeletionPolicyKeepLatestCountPerDbClusterIdentifier = env['TARGET_DELETION_POLICY_KEEP_LATEST_COUNT_PER_DB_CLUSTER_IDENTIFIER'];
    if (typeof rawTargetDeletionPolicyKeepLatestCountPerDbClusterIdentifier !== 'undefined') {
        deletionPolicy.keepLatestCountPerDbClusterIdentifier = parseInt(rawTargetDeletionPolicyKeepLatestCountPerDbClusterIdentifier, 10);
        deletionPolicyNotEmpty = true;
    }

    const rawTargetDeletionPolicyKeepCreatedInTheLastSeconds = env['TARGET_DELETION_POLICY_KEEP_CREATED_IN_THE_LAST_SECONDS'];
    if (typeof rawTargetDeletionPolicyKeepCreatedInTheLastSeconds !== 'undefined') {
        deletionPolicy.keepCreatedInTheLastSeconds = parseInt(rawTargetDeletionPolicyKeepCreatedInTheLastSeconds, 10);
        deletionPolicyNotEmpty = true;
    }

    const rawTargetDeletionPolicyApply = env['TARGET_DELETION_POLICY_APPLY'];
    if (typeof rawTargetDeletionPolicyApply !== 'undefined') {
        deletionPolicy.apply = !!rawTargetDeletionPolicyApply;
        deletionPolicyNotEmpty = true;
    }

    if (deletionPolicyNotEmpty) {
        target.deletionPolicy = deletionPolicy;
    }

    const options: AuroraSnapshotHandlerOptions = {
        sources,
        target,
    };

    const rawLatestCountPerCluster = env['AGGREGATION_LATEST_COUNT_PER_CLUSTER'];
    if (typeof rawLatestCountPerCluster !== 'undefined') {
        options.aggregation = {
            latestCountPerCluster: parseInt(rawLatestCountPerCluster, 10),
        };
    }

    return options;
};
