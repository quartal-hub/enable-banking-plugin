/**
 * A sample tool class. Every public method of an exported class becomes an MCP tool and a REST
 * action; the JSDoc comments and TypeScript types become the tool descriptions and schemas.
 */
export class HelloWorld {
  /**
   * Say hello.
   * @param input - The parameters.
   * @returns The greeting.
   */
  static sayHello(input: {
    /** The name to say hello to. */
    name?: string;
  }): string {
    return `Hello, ${input.name ?? "World"}!`;
  }
}
