export type Queue<T> = {
  readonly size: number;
  enqueue(value: T): void;
  dequeue(): T | undefined;
  clear(): void;
};

export function createQueue<T>(): Queue<T> {
  return new IndexedQueue<T>();
}

class IndexedQueue<T> implements Queue<T> {
  private items: T[] = [];
  private head = 0;

  get size() {
    return this.items.length - this.head;
  }

  enqueue(value: T) {
    this.items.push(value);
  }

  dequeue() {
    if (this.head >= this.items.length) return undefined;

    const value = this.items[this.head];
    this.head += 1;

    if (this.head === this.items.length) {
      this.clear();
    } else if (this.head >= 64 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }

    return value;
  }

  clear() {
    this.items = [];
    this.head = 0;
  }
}
