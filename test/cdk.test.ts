import { expect as cdkExpect, haveResource } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { Schedule } from '@aws-cdk/aws-events';
import '@aws-cdk/assert/jest';

import { AuroraSnapshotCopier } from '..';

describe('construct', () => {
    test('simple, dry run', () => {
        const stack = new Stack();

        new AuroraSnapshotCopier(stack, 'Copier', {
            sources: [
                {
                    dbClusterIdentifier: 'myidentifier',
                },
            ],
            target: {
                regions: ['eu-west-1', 'eu-central-1'],
            },
        });

        cdkExpect(stack).to(
            haveResource('AWS::Lambda::Function', {
                Environment: {
                    Variables: {
                        SOURCE_0_DB_CLUSTER_IDENTIFIER: 'myidentifier',
                        TARGET_REGIONS: 'eu-west-1,eu-central-1',
                        INSTANCE_IDENTIFIER: 'default',
                    },
                },
            }),
        );
    });

    test('simple, schedule', () => {
        const stack = new Stack();

        new AuroraSnapshotCopier(stack, 'Copier', {
            sources: [
                {
                    dbClusterIdentifier: 'myidentifier',
                },
            ],
            target: {
                regions: ['eu-west-1', 'eu-central-1'],
            },
            schedule: Schedule.cron({
                hour: '0',
                minute: '0',
            }),
        });

        cdkExpect(stack).to(
            haveResource('AWS::Events::Rule', {
                ScheduleExpression: 'cron(0 0 * * ? *)',
            }),
        );
    });
});
