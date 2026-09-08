const path = require('path');
const fs = require('fs');
const { readJson, writeJson, DATA_DIR } = require('../utils/fileStore');

// Create a temp test file
const testFile = path.join(__dirname, '__test_file__.json');

afterAll(() => {
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
});

describe('fileStore utils', () => {
  describe('DATA_DIR', () => {
    it('should point to backend/data', () => {
      expect(DATA_DIR).toContain('data');
      expect(fs.existsSync(DATA_DIR)).toBe(true);
    });
  });

  describe('readJson', () => {
    it('should read existing JSON file', () => {
      const data = readJson(path.join(DATA_DIR, 'products.json'));
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent file', () => {
      const data = readJson(path.join(DATA_DIR, 'nonexistent.json'));
      expect(data).toEqual([]);
    });

    it('should throw for invalid JSON (never silently [])', () => {
      const badFile = path.join(__dirname, '__bad_json__.json');
      fs.writeFileSync(badFile, '{invalid json', 'utf8');
      expect(() => readJson(badFile)).toThrow();
      fs.unlinkSync(badFile);
      // prune any corrupt backup the failed read created
      fs.readdirSync(__dirname)
        .filter(f => f.startsWith('__bad_json__.json.corrupt.'))
        .forEach(f => fs.unlinkSync(path.join(__dirname, f)));
    });
  });

  describe('writeJson', () => {
    it('should write JSON to file', () => {
      const data = [{ id: 1, name: 'test' }];
      writeJson(testFile, data);
      const raw = fs.readFileSync(testFile, 'utf8');
      expect(JSON.parse(raw)).toEqual(data);
    });

    it('should overwrite existing file', () => {
      writeJson(testFile, [{ id: 2 }]);
      const data = readJson(testFile);
      expect(data).toEqual([{ id: 2 }]);
    });
  });
});
