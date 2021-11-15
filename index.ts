import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as events from '@aws-cdk/aws-events';
import * as eventsTargets from '@aws-cdk/aws-events-targets';

import * as pathlib from 'path';

import { AuroraSnapshotHandlerOptions, allToEnv } from './handler/shared';

export { AuroraSnapshotSourceSelector, AuroraSnapshotSourceAggregation, AuroraSnapshotTarget, AuroraSnapshotDeletionPolicy } from './handler/shared';
import { PickPartial, objOf } from './handler/utils';

export type Partialed = PickPartial<AuroraSnapshotHandlerOptions, 'instanceIdentifier'>;

export interface AuroraSnapshotCopierProps extends Partialed {
    handlerTimeout?: cdk.Duration;
    schedule?: events.Schedule;
}

export class AuroraSnapshotCopier extends cdk.Construct {
    constructor(scope: cdk.Construct, identifier: string, props: AuroraSnapshotCopierProps) {
        super(scope, identifier);

        const instanceIdentifier = props.instanceIdentifier ?? 'default';

        const handler = new lambda.Function(this, 'Handler', {
            code: lambda.Code.fromAsset(pathlib.join(__dirname, 'handler')),
            runtime: lambda.Runtime.NODEJS_14_X,
            handler: 'main.handler',
            timeout: props.handlerTimeout ?? cdk.Duration.minutes(1),
            environment: allToEnv({
                ...props,
                instanceIdentifier,
            }),
        });

        handler.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['rds:DescribeDBClusterSnapshots', 'rds:CopyDBClusterSnapshot'],
                resources: ['*'],
            }),
        );
        handler.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['kms:ListAliases'],
                resources: ['*'],
            }),
        );

        if (typeof props.target.deletionPolicy !== 'undefined') {
            handler.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ['rds:AddTagsToResource'],
                    resources: ['*'],
                }),
            );

            if (props.target.deletionPolicy.apply) {
                handler.addToRolePolicy(
                    new iam.PolicyStatement({
                        actions: ['rds:DeleteDBClusterSnapshot'],
                        resources: ['*'],
                        conditions: {
                            StringEquals: objOf(`aws:ResourceTag/aurora-snapshot-copier-cdk/CopiedBy/${instanceIdentifier}`, 'aurora-snapshot-copier-cdk'),
                        },
                    }),
                );
            }
        }

        if (typeof props.schedule !== 'undefined') {
            new events.Rule(this, 'ScheduleRule', {
                description: 'Event rule to run aurora-snapshot-copier-cdk on a schedule',
                schedule: props.schedule,
                targets: [new eventsTargets.LambdaFunction(handler)],
            });
        }
    }
}
