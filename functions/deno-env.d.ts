// Declaración mínima del runtime de Deno para el typecheck local.
declare const Deno: {
  env: { get(key: string): string | undefined };
};
