import { repro } from '@repro/config/eslint';
export default [{ ignores: ['test/fixtures/**'] }, ...repro({ node: true })];
