var flush = true;
describe('objUtils', function() {
    var objUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        objUtils = require('../../lib/objUtils');
    });
   
    describe('sortObject', function() {
        it('should simply return the obj if not an object', function() {
            expect(objUtils.sortObject('abcd')).toBe('abcd');
            expect(objUtils.sortObject(10)).toBe(10);
        });
        
        it('should recursively sort an object by its keys', function() {
            var obj = {b: 1, a: 2, c: 5};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: 1, c: 5}));
            
            var obj = {b: {f: 3, e: 8}, a: 2, c: [3, 2, 1]};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: {e: 8, f: 3}, c: [3, 2, 1]}));
            
            var obj = {b: [{h: 1, g: 2}, {e: 5, f: 3}], a: 2};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: [{g: 2, h: 1}, {e: 5, f: 3}]}));
        });
        
        it('should be able to handle null fields', function() {
            var obj = {b: 1, a: null}, sorted;
            expect(function() {sorted = objUtils.sortObject(obj);}).not.toThrow();
            expect(sorted).toEqual({a: null, b: 1});
        });
    });

    describe('compareObjects', function() {
        it('should perform a deep equality check on two objects', function() {
            var a = { foo: 'bar', arr: [1, 3, 2] }, b = { foo: 'bar', arr: [1, 2, 2] };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            b.arr[1] = 3;
            expect(objUtils.compareObjects(a, b)).toBe(true);
            a.foo = 'baz';
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.foo = 'bar';
            a.data = { user: 'otter' };
            b.data = { user: 'otter', org: 'c6' };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.data.org = 'c6';
            expect(objUtils.compareObjects(a, b)).toBe(true);
        });
    });

    describe('trimNull', function() {
        it('should trim any fields with null values from an object', function() {
            var obj = { a: 1, b: null, nested: { c: null, d: undefined, e: 3 } };
            objUtils.trimNull(obj);
            expect(obj).toEqual({ a: 1, nested: { d: undefined, e: 3 } });
            
            obj = 'foo';
            objUtils.trimNull(obj);
            expect(obj).toBe('foo');
        });
    });
    
    describe('isListDistinct', function() {
        it('should return true if the return true if a list has all distinct elements', function() {
            expect(objUtils.isListDistinct(['a', 'b', 'aa'])).toBe(true);
            expect(objUtils.isListDistinct(['a', 'b', 'a'])).toBe(false);
            expect(objUtils.isListDistinct([1, '1', 2])).toBe(true);
            expect(objUtils.isListDistinct([1, 1, 2])).toBe(false);
        });
        
        it('should return true if the list is undefined', function() {
            expect(objUtils.isListDistinct(undefined)).toBe(true);
        });
    });
});
