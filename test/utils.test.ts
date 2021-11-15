import { fromAwsTags, kmsKeyIdOrArnToId, isArrayOfStrings, hasKey, objOf } from '../handler/utils';

describe('fromAwsTags', () => {
    test('empty', () => {
        expect(fromAwsTags(undefined)).toEqual({});
    });

    test('empty list', () => {
        expect(fromAwsTags([])).toEqual({});
    });

    test('one tag', () => {
        expect(
            fromAwsTags([
                {
                    Key: 'key',
                    Value: 'value',
                },
            ]),
        ).toEqual({
            key: 'value',
        });
    });

    test('two tags', () => {
        expect(
            fromAwsTags([
                {
                    Key: 'key',
                    Value: 'value',
                },
                {
                    Key: 'key2',
                    Value: 'value2',
                },
            ]),
        ).toEqual({
            key: 'value',
            key2: 'value2',
        });
    });

    test('ignore if missing key', () => {
        expect(
            fromAwsTags([
                {
                    Key: undefined,
                    Value: 'value',
                },
            ]),
        ).toEqual({});
    });

    test('ignore if missing value', () => {
        expect(
            fromAwsTags([
                {
                    Key: 'key',
                    Value: undefined,
                },
            ]),
        ).toEqual({});
    });
});

describe('kmsKeyIdOrArnToId', () => {
    test('id', () => {
        expect(kmsKeyIdOrArnToId('myid')).toEqual('myid');
    });

    test('arn', () => {
        expect(kmsKeyIdOrArnToId('arn:aws:kms:us-east-1:123412341234:key/myid')).toEqual('myid');
    });
});

describe('isArrayOfStrings', () => {
    test('not an array', () => {
        expect(isArrayOfStrings('this is not an array')).toEqual(false);
    });

    test('array of strings', () => {
        expect(isArrayOfStrings(['a', 'b'])).toEqual(true);
    });

    test('array of not strings', () => {
        expect(isArrayOfStrings([null, new Date()])).toEqual(false);
    });

    test('array of some strings', () => {
        expect(isArrayOfStrings([null, 'a', new Date()])).toEqual(false);
    });
});

describe('hasKey', () => {
    test('does have key', () => {
        expect(hasKey({ foo: 'bar' }, 'foo')).toEqual(true);
    });

    test('does not have key', () => {
        expect(hasKey({ baz: 'bar' }, 'foo')).toEqual(false);
    });

    test('is not object', () => {
        expect(hasKey(3, 'foo')).toEqual(false);
    });

    test('is null', () => {
        expect(hasKey(null, 'foo')).toEqual(false);
    });
});

describe('objOf', () => {
    test('simple', () => {
        expect(objOf('foo', 'bar')).toEqual({
            foo: 'bar',
        });
    });
});
