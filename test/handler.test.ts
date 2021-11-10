import * as AWS from 'aws-sdk';
import * as AWSMock from 'aws-sdk-mock';
import * as sinon from 'sinon';

import * as handlerMain from '../handler/main';

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
