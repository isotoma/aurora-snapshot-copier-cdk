import { Stack, Duration } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { Template } from 'aws-cdk-lib/assertions';

import { AuroraSnapshotCopier } from '../cdkv2';

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

        const template = Template.fromStack(stack);

        template.hasResourceProperties('AWS::Lambda::Function', {
            Environment: {
                Variables: {
                    SOURCE_0_DB_CLUSTER_IDENTIFIER: 'myidentifier',
                    TARGET_REGIONS: 'eu-west-1,eu-central-1',
                    INSTANCE_IDENTIFIER: 'default',
                },
            },
        });
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

        const template = Template.fromStack(stack);

        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'cron(0 0 * * ? *)',
        });
    });

    test('simple, deletion policy', () => {
        const stack = new Stack();

        new AuroraSnapshotCopier(stack, 'Copier', {
            sources: [
                {
                    dbClusterIdentifier: 'myidentifier',
                },
            ],
            target: {
                regions: ['eu-west-1', 'eu-central-1'],
                deletionPolicy: {
                    keepCreatedInTheLast: Duration.minutes(2),
                    keepLatestCountPerDbClusterIdentifier: 3,
                },
            },
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties('AWS::Lambda::Function', {
            Environment: {
                Variables: {
                    SOURCE_0_DB_CLUSTER_IDENTIFIER: 'myidentifier',
                    TARGET_REGIONS: 'eu-west-1,eu-central-1',
                    INSTANCE_IDENTIFIER: 'default',
                    TARGET_DELETION_POLICY_KEEP_LATEST_COUNT_PER_DB_CLUSTER_IDENTIFIER: '3',
                    // CDK Duration is converted to seconds
                    TARGET_DELETION_POLICY_KEEP_CREATED_IN_THE_LAST_SECONDS: '120',
                },
            },
        });
    });
});
