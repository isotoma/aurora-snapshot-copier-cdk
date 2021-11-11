import { toEnv, fromEnv, allToEnv, allFromEnv } from '../handler/shared';

const SAMPLE_SOURCE = {
    dbClusterIdentifier: 'mysourcedbclusteridentifier',
    tags: {
        foo: ['fooA', 'fooB'],
        bar: ['barA', 'barB'],
    },
    snapshotCreateTimeNotBefore: new Date('2021-07-01'),
    snapshotType: 'mysnapshottype',
};

describe('toEnv/fromEnv', () => {
    test('toEnv', () => {
        expect(toEnv(SAMPLE_SOURCE, 0)).toEqual({
            SOURCE_0_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier',
            SOURCE_0_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
            SOURCE_0_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
            SOURCE_0_SNAPSHOT_TYPE: 'mysnapshottype',
        });
    });

    test('fromEnv', () => {
        expect(
            fromEnv(
                {
                    SOURCE_0_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier',
                    SOURCE_0_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
                    SOURCE_0_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
                    SOURCE_0_SNAPSHOT_TYPE: 'mysnapshottype',
                },
                0,
            ),
        ).toEqual(SAMPLE_SOURCE);
    });

    test('fromEnv tag true', () => {
        expect(
            fromEnv(
                {
                    SOURCE_0_TAGS: '{"foo":true}',
                },
                0,
            ),
        ).toEqual({
            tags: {
                foo: true,
            },
        });
    });

    test('fromEnv bad json', () => {
        // Should ignore the bad json
        expect(
            fromEnv(
                {
                    SOURCE_0_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier',
                    SOURCE_0_TAGS: 'this is not valid json {',
                },
                0,
            ),
        ).toEqual({
            dbClusterIdentifier: 'mysourcedbclusteridentifier',
        });
    });

    test('round trip', () => {
        expect(fromEnv(toEnv(SAMPLE_SOURCE, 0), 0)).toEqual(SAMPLE_SOURCE);
    });
});

describe('allToEnv/allFromEnv', () => {
    test('allToEnv', () => {
        expect(
            allToEnv({
                sources: [
                    {
                        ...SAMPLE_SOURCE,
                        dbClusterIdentifier: 'mysourcedbclusteridentifier_1',
                    },
                    {
                        ...SAMPLE_SOURCE,
                        dbClusterIdentifier: 'mysourcedbclusteridentifier_2',
                    },
                ],
                aggregation: {
                    latestCountPerCluster: 3,
                },
                target: {
                    regions: ['myregion1', 'myregion2'],
                    deletionPolicy: {
                        keepLatestCountPerDbClusterIdentifier: 5,
                        keepCreatedInTheLastSeconds: 60 * 60 * 24 * 31,
                        apply: true,
                    },
                },
            }),
        ).toEqual({
            SOURCE_0_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier_1',
            SOURCE_0_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
            SOURCE_0_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
            SOURCE_0_SNAPSHOT_TYPE: 'mysnapshottype',
            SOURCE_1_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier_2',
            SOURCE_1_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
            SOURCE_1_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
            SOURCE_1_SNAPSHOT_TYPE: 'mysnapshottype',
            AGGREGATION_LATEST_COUNT_PER_CLUSTER: '3',
            TARGET_REGIONS: 'myregion1,myregion2',
            TARGET_DELETION_POLICY_APPLY: '1',
            TARGET_DELETION_POLICY_KEEP_CREATED_IN_THE_LAST_SECONDS: '2678400',
            TARGET_DELETION_POLICY_KEEP_LATEST_COUNT_PER_DB_CLUSTER_IDENTIFIER: '5',
        });
    });

    test('allFromEnv', () => {
        expect(
            allFromEnv({
                SOURCE_0_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier_1',
                SOURCE_0_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
                SOURCE_0_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
                SOURCE_0_SNAPSHOT_TYPE: 'mysnapshottype',
                SOURCE_1_DB_CLUSTER_IDENTIFIER: 'mysourcedbclusteridentifier_2',
                SOURCE_1_TAGS: '{"foo":["fooA","fooB"],"bar":["barA","barB"]}',
                SOURCE_1_SNAPSHOT_CREATE_TIME_NOT_BEFORE: '2021-07-01T00:00:00.000Z',
                SOURCE_1_SNAPSHOT_TYPE: 'mysnapshottype',
                AGGREGATION_LATEST_COUNT_PER_CLUSTER: '3',
                TARGET_REGIONS: 'myregion1,myregion2',
                TARGET_DELETION_POLICY_APPLY: '1',
                TARGET_DELETION_POLICY_KEEP_CREATED_IN_THE_LAST_SECONDS: '2678400',
                TARGET_DELETION_POLICY_KEEP_LATEST_COUNT_PER_DB_CLUSTER_IDENTIFIER: '5',
            }),
        ).toEqual({
            sources: [
                {
                    ...SAMPLE_SOURCE,
                    dbClusterIdentifier: 'mysourcedbclusteridentifier_1',
                },
                {
                    ...SAMPLE_SOURCE,
                    dbClusterIdentifier: 'mysourcedbclusteridentifier_2',
                },
            ],
            aggregation: {
                latestCountPerCluster: 3,
            },
            target: {
                regions: ['myregion1', 'myregion2'],
                deletionPolicy: {
                    keepLatestCountPerDbClusterIdentifier: 5,
                    keepCreatedInTheLastSeconds: 60 * 60 * 24 * 31,
                    apply: true,
                },
            },
        });
    });

    test('round trip', () => {
        const options = {
            sources: [
                {
                    ...SAMPLE_SOURCE,
                    dbClusterIdentifier: 'mysourcedbclusteridentifier_1',
                },
                {
                    ...SAMPLE_SOURCE,
                    dbClusterIdentifier: 'mysourcedbclusteridentifier_2',
                },
            ],
            aggregation: {
                latestCountPerCluster: 3,
            },
            target: {
                regions: ['myregion1', 'myregion2'],
                deletionPolicy: {
                    keepLatestCountPerDbClusterIdentifier: 5,
                    keepCreatedInTheLastSeconds: 60 * 60 * 24 * 31,
                    apply: true,
                },
            },
        };

        expect(allFromEnv(allToEnv(options))).toEqual(options);
    });
});
