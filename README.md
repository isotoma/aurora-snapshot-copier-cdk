# aurora-snapshot-copier-cdk
For copying Aurora snapshots between regions on a schedule

[![docs](https://img.shields.io/badge/docs-!-brightgreen)](https://isotoma.github.io/aurora-snapshot-copier-cdk/) [![npm](https://img.shields.io/npm/v/aurora-snapshot-copier-cdk)](https://www.npmjs.com/package/aurora-snapshot-copier-cdk) [![NPM](https://img.shields.io/npm/l/aurora-snapshot-copier-cdk)](./LICENSE)

## Getting started

```typescript
import { AuroraSnapshotCopier } from 'aurora-snapshot-copier-cdk';

// ...

new AuroraSnapshotCopier(this, 'AuroraSnapshotCopier', {
    // Specify a list of source filters.
    // To be considered for copying, a snapshot must match
    // all filters for at least one source
    sources: [{
        // Filter by cluster identifier
        dbClusterIdentifier: 'mysourceclusteridenifier',
        // By tags
        tags: {
            // The tag on the snapshot must match one of the values in the list
            myTag: ['tagValue', 'otherTagValue'],
            // Or if `true`, then the tag just must exist on the snapshot at all
            myOtherTag: true,
        },
        // By create time
        snapshotCreateTimeNotBefore: new Date('2021-01-01'),
    }],
    aggregation: {
        // Copy at most this many snapshots per run
        latestCountPerCluster: 2,
    },
    target: {
        // The regions to copy into
        regions: ['eu-west-2'],
        deletionPolicy: {
            // The number of copied snapshots to retain in each target region
            keepLatestCountPerDbClusterIdentifier: 1,
            // By default, just marks snapshots that it would have liked to delete.
            // Set this to actually do the deleting
            // apply: true,
        },
    },
});
```

## TODO:

- More docs
