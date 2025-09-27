type Data =
  Uint8Array |
  Uint8ClampedArray |
  Int8Array |
  Uint16Array |
  Int16Array |
  Uint32Array |
  Int32Array |
  Float32Array |
  Float64Array |
  BigUint64Array |
  BigInt64Array;

interface ViewConstuctor<T extends Data> {
  BYTES_PER_ELEMENTS: number;
  new(buffer: ArrayBuffer, byteOffser: number, length: number): T;
}

interface PointerOptions<T extends Data> {
  length: number;
  memory: Uint8Array;
  alignment: number;
  View: ViewConstuctor<T>
}

class Pointer<T extends Data> {
  readonly index: number;

  readonly length: number;

  readonly alignment: number;

  readonly memory: Uint8Array; // stack or heap

  readonly View: ViewConstuctor<T>

  constructor(index: number, { memory, alignment, length, View }: PointerOptions<T>) {
    this.index = index;

    this.memory = memory;

    this.alignment = alignment;

    this.length = length;

    this.View = View;
  }

  deref(): T {
    const { View } = this

    return new View(this.memory.buffer, this.memory.byteOffset + this.index, this.length);
  }

  change(data: T): void {
    const view = this.deref();

    if (view.length < data.length) {
      throw new Error('Слишком большие данные');
    }

    view.set(<any>data);

    if (view.length > data.length) {
      const end = this.index + view.length * view.BYTES_PER_ELEMENT;

      this.memory.fill(0, end - (view.length - data.length) * view.BYTES_PER_ELEMENT, end);
    }
  }
}


interface FreeBlock {
  offset: number;
  size: number;

}

interface MemoryOptions {
  stack?: number;
}

class Memory {
  protected buffer: ArrayBuffer;

  protected heap: Uint8Array;
  protected freeBlock: FreeBlock[];

  protected stack: Uint8Array;
  protected stackPointer = -1;

  constructor(size: number, { stack }: MemoryOptions = {}) {
    size >>>= 0;

    this.buffer = new ArrayBuffer(size);

    stack ??= Math.floor(size * 0.3);

    if (stack >= 0.5 * size) {
      throw new Error("Стек слишком большой");
    }

    this.stack = new Uint8Array(this.buffer, 0, stack);

    this.heap = new Uint8Array(this.buffer, stack);

    this.freeBlock = [{ offset: 0, size: this.heap.length }];
  }

  push<T extends Data>(data: T): Pointer<T> {
    const bytesLength = data.length * data.BYTES_PER_ELEMENT;

    if (this.stackPointer + bytesLength > this.stack.length) {
      throw new Error('Стек переполнен');
    }

    const bytes = new Uint8Array(data.buffer, data.byteOffset, bytesLength);

    this.stackPointer++;

    const aligment = this.getAlignment(this.stackPointer, data.BYTES_PER_ELEMENT);

    this.stackPointer += aligment;

    this.stack.set(bytes, this.stackPointer);

    const pt = new Pointer<T>(this.stackPointer, {
      memory: this.stack,
      length: data.length,
      alignment: aligment,
      View: <any>data.constructor
    });

    this.stackPointer += bytes.length - 1;

    return pt;
  }

  pop(pt: Pointer<any>) {
    const { BYTES_PER_ELEMENTS } = pt.View;

    this.stackPointer -= pt.length * BYTES_PER_ELEMENTS + pt.alignment;

    if (this.stackPointer < -1) {
      this.stackPointer = -1;
    }
  }

  protected getAlignment(n: number, k: number): number {
    const reminder = n % k;

    if (reminder === 0) {
      return 0;
    }

    return k - reminder;
  }
}

const mem = new Memory(1024, { stack: 256 });

const pt1 = mem.push(new Int16Array([1, -1, -2, 145]));
const pt2 = mem.push(new Int32Array([568, -123]));
const pt3 = mem.push(new BigInt64Array([12345678n]));

console.log(pt1.deref());
console.log(pt2.deref());
console.log(pt3.deref());

pt1.change(new Int16Array([-65]));

console.log(pt1.deref());

mem.pop(pt3);

console.log(pt3.deref());

const pt4 = mem.push(new Uint32Array([2, 3, 1, 43, 5, 6, 4, 3, 2, 1, 2]));


console.log(pt3.deref());

