/**
 * 深度合并工具
 * 
 * 参考 oh-my-opencode/src/shared/deep-merge.ts
 */

type DeepMergeable = Record<string, unknown>;

/**
 * 深度合并两个对象
 */
export function deepMerge<T extends DeepMergeable>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (isObject(sourceValue) && isObject(targetValue)) {
        result[key] = deepMerge(targetValue as DeepMergeable, sourceValue as DeepMergeable) as T[Extract<keyof T, string>];
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 深度合并多个对象
 */
export function deepMergeAll<T extends DeepMergeable>(...objects: Array<Partial<T>>): T {
  return objects.reduce((acc, obj) => deepMerge(acc as T, obj), {} as T) as T;
}
