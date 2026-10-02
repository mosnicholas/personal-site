// Lets Node run the eval scripts, which import the API's TypeScript modules
// with .js specifiers like the API itself does: a relative .js import that
// doesn't exist resolves to the .ts file next to it.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
