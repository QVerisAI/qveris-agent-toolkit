type Schema = Record<string, unknown>;

function makeSchema(type: string, options?: Schema): Schema {
  return {
    type,
    ...(options ?? {}),
  };
}

export const Type = {
  Object(properties: Record<string, unknown>, options?: Schema): Schema {
    return {
      type: "object",
      properties,
      ...(options ?? {}),
    };
  },

  String(options?: Schema): Schema {
    return makeSchema("string", options);
  },

  Number(options?: Schema): Schema {
    return makeSchema("number", options);
  },

  Optional(schema: Schema): Schema {
    return {
      ...schema,
      optional: true,
    };
  },
};
