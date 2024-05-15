import * as RDS from '@aws-sdk/client-rds';

export type PickRequired<T, Keys extends keyof T> = Required<Pick<T, Keys>> & Omit<T, Keys>;
export type PickPartial<T, Keys extends keyof T> = Partial<Pick<T, Keys>> & Omit<T, Keys>;

export const fromAwsTags = (awsTags: RDS.Tag[] | undefined): Record<string, string> => {
    const tags: Record<string, string> = {};
    for (const awsTag of awsTags || []) {
        if (typeof awsTag.Key === 'string' && typeof awsTag.Value === 'string') {
            tags[awsTag.Key] = awsTag.Value;
        }
    }
    return tags;
};

export const kmsKeyIdOrArnToId = (keyIdOrArn: string): string => {
    if (keyIdOrArn.startsWith('arn:aws:kms:')) {
        return keyIdOrArn.replace(/.*\//, '');
    }

    return keyIdOrArn;
};

export const isArrayOfStrings = (obj: unknown): obj is Array<string> => {
    if (!Array.isArray(obj)) {
        return false;
    }

    for (const item of obj) {
        if (typeof item !== 'string') {
            return false;
        }
    }
    return true;
};

export const hasKey = <T, K extends PropertyKey>(obj: unknown, prop: K): obj is T & Record<K, unknown> => {
    return typeof obj === 'object' && !!obj && Object.prototype.hasOwnProperty.call(obj, prop);
};

export const objOf = (key: string, value: string): Record<string, string> => {
    const obj: Record<string, string> = {};
    obj[key] = value;
    return obj;
};
