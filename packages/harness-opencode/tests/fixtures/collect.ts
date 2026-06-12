export async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
}
