import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

import * as pathlib from 'path';

import { AuroraSnapshotHandlerOptions, AuroraSnapshotDeletionPolicy, AuroraSnapshotTarget, allToEnv } from './handler/shared';

export { AuroraSnapshotSourceSelector, AuroraSnapshotSourceAggregation } from './handler/shared';
import { PickPartial, objOf } from './handler/utils';

export interface CdkAuroraSnapshotDeletionPolicy extends Omit<AuroraSnapshotDeletionPolicy, 'keepCreatedInTheLastSeconds'> {
    keepCreatedInTheLast?: cdk.Duration;
}

export interface CdkAuroraSnapshotTarget extends Omit<AuroraSnapshotTarget, 'deletionPolicy'> {
    deletionPolicy?: CdkAuroraSnapshotDeletionPolicy;
}

export interface CdkAuroraSnapshotHandlerOptions extends Omit<PickPartial<AuroraSnapshotHandlerOptions, 'instanceIdentifier'>, 'target'> {
    handlerTimeout?: cdk.Duration;
    schedule?: events.Schedule;
    target: CdkAuroraSnapshotTarget;
}

const simplifyDeletionPolicy = (cdkDeletionPolicy: CdkAuroraSnapshotDeletionPolicy): AuroraSnapshotDeletionPolicy => {
    return {
        ...cdkDeletionPolicy,
        ...(typeof cdkDeletionPolicy.keepCreatedInTheLast !== 'undefined'
            ? {
                  keepCreatedInTheLastSeconds: cdkDeletionPolicy.keepCreatedInTheLast.toSeconds(),
              }
            : {}),
    };
};

const simplifyProps = (cdkProps: CdkAuroraSnapshotHandlerOptions): AuroraSnapshotHandlerOptions => {
    const instanceIdentifier = cdkProps.instanceIdentifier ?? 'default';

    return {
        ...cdkProps,
        target: {
            ...cdkProps.target,
            ...(typeof cdkProps.target.deletionPolicy !== 'undefined'
                ? {
                      deletionPolicy: simplifyDeletionPolicy(cdkProps.target.deletionPolicy),
                  }
                : {}),
        },
        instanceIdentifier,
    };
};

export class AuroraSnapshotCopier extends Construct {
    constructor(scope: Construct, identifier: string, props: CdkAuroraSnapshotHandlerOptions) {
        super(scope, identifier);

        const simplifiedProps: AuroraSnapshotHandlerOptions = simplifyProps(props);

        const handler = new lambda.Function(this, 'Handler', {
            code: lambda.Code.fromAsset(pathlib.join(__dirname, 'handler')),
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'main.handler',
            timeout: props.handlerTimeout ?? cdk.Duration.minutes(1),
            environment: allToEnv(simplifiedProps),
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

        if (typeof simplifiedProps.target.deletionPolicy !== 'undefined') {
            handler.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ['rds:AddTagsToResource'],
                    resources: ['*'],
                }),
            );

            if (simplifiedProps.target.deletionPolicy.apply) {
                handler.addToRolePolicy(
                    new iam.PolicyStatement({
                        actions: ['rds:DeleteDBClusterSnapshot'],
                        resources: ['*'],
                        conditions: {
                            StringEquals: objOf(`aws:ResourceTag/aurora-snapshot-copier-cdk/CopiedBy/${simplifiedProps.instanceIdentifier}`, 'aurora-snapshot-copier-cdk'),
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
