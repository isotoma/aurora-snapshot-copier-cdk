import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';

import * as pathlib from 'path';

import { AuroraSnapshotHandlerOptions, allToEnv } from './handler/shared';

export { AuroraSnapshotSourceSelector, AuroraSnapshotSourceAggregation, AuroraSnapshotTarget, AuroraSnapshotDeletionPolicy } from './handler/shared';

export interface AuroraSnapshotCopierProps extends AuroraSnapshotHandlerOptions {
    handlerTimeout?: cdk.Duration;
}

export class AuroraSnapshotCopier extends cdk.Construct {
    constructor(scope: cdk.Construct, identifier: string, props: AuroraSnapshotCopierProps) {
        super(scope, identifier);

        const handler = new lambda.Function(this, 'Handler', {
            code: lambda.Code.fromAsset(pathlib.join(__dirname, 'handler')),
            runtime: lambda.Runtime.NODEJS_14_X,
            handler: 'main.handler',
            timeout: props.handlerTimeout ?? cdk.Duration.minutes(1),
            environment: allToEnv(props),
        });

        handler.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['rds:DescribeDBClusterSnapshots', 'rds:CopyDBClusterSnapshot', 'rds:AddTagsToResource'],
                resources: ['*'],
            }),
        );
        handler.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['kms:ListAliases'],
                resources: ['*'],
            }),
        );
    }
}
