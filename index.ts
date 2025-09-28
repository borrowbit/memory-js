type Data =
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigUint64Array
  | BigInt64Array;

interface ViewConstructor<T extends Data> {
  BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): T;
}

interface PointerOptions<T extends Data> {
  length: number;
  memory: Uint8Array;
  alignment: number;
  View: ViewConstructor<T>;
}

class Pointer<T extends Data> {
  readonly index: number;

  readonly length: number;

  readonly alignment: number;

  readonly memory: Uint8Array; // stack or heap

  readonly View: ViewConstructor<T>;

  constructor(
    index: number,
    { memory, alignment, length, View }: PointerOptions<T>
  ) {
    this.index = index;

    this.memory = memory;

    this.alignment = alignment;

    this.length = length;

    this.View = View;
  }

  deref(): T {
    const { View } = this;

    return new View(
      this.memory.buffer,
      this.memory.byteOffset + this.index,
      this.length
    );
  }

  change(data: T): void {
    const view = this.deref();

    if (view.length < data.length) {
      throw new Error("Слишком большие данные");
    }

    view.set(<any>data);

    if (view.length > data.length) {
      const end = this.index + view.length * view.BYTES_PER_ELEMENT;

      this.memory.fill(
        0,
        end - (view.length - data.length) * view.BYTES_PER_ELEMENT,
        end
      );
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

    this.freeBlock = [{ offset: 0, size: this.heap.length }]; // use b-tree?
  }

  push<T extends Data>(data: T): Pointer<T> {
    const bytesLength = data.length * data.BYTES_PER_ELEMENT;

    if (this.stackPointer + bytesLength > this.stack.length) {
      throw new Error("Стек переполнен");
    }

    const bytes = new Uint8Array(data.buffer, data.byteOffset, bytesLength);

    this.stackPointer++;

    const alignment = this.getAlignment(
      this.stackPointer,
      data.BYTES_PER_ELEMENT
    );

    this.stackPointer += alignment;

    this.stack.set(bytes, this.stackPointer);

    const pt = new Pointer<T>(this.stackPointer, {
      memory: this.stack,
      length: data.length,
      alignment: alignment,
      View: <any>data.constructor,
    });

    this.stackPointer += bytes.length - 1;

    return pt;
  }

  pop(pt: Pointer<any>) {
    const { BYTES_PER_ELEMENT } = pt.View;

    this.stackPointer -= pt.length * BYTES_PER_ELEMENT + pt.alignment;

    if (this.stackPointer < -1) {
      this.stackPointer = -1;
    }
  }

  alloc<T extends Data>(length: number, DataType: ViewConstructor<T>) {
    const size = length * DataType.BYTES_PER_ELEMENT;

    for (const [i, block] of this.freeBlock.entries()) {
      const alignment = this.getAlignment(
        block.offset,
        DataType.BYTES_PER_ELEMENT
      );

      const alignedSize = size + alignment;

      if (block.size >= alignedSize) {
        const pt = new Pointer(block.offset + alignment, {
          memory: this.heap,
          length,
          alignment,
          View: DataType,
        });

        block.offset += alignedSize;
        block.size -= alignedSize;

        if (block.size === 0) {
          this.freeBlock.splice(i, 1);
        }

        return pt;
      }
    }

    throw new Error("Не хватает памяти");
  }

  protected mergeFreeBlocks() {
    for (let i = 0; i < this.freeBlock.length - 1; i++) {
      const current = this.freeBlock[i];
      const next = this.freeBlock[i + 1];

      if (current.offset + current.size === next.offset) {
        current.size += next.size;

        this.freeBlock.splice(i + 1, 1);

        i--;
      }
    }
  }

  free(pt: Pointer<any>): void {
    this.freeBlock.push({
      offset: pt.index - pt.alignment,
      size: pt.length * pt.View.BYTES_PER_ELEMENT,
    });

    this.freeBlock.sort((a, b) => a.offset - b.offset);

    this.mergeFreeBlocks();
  }

  protected getAlignment(n: number, k: number): number {
    const reminder = n % k;

    if (reminder === 0) {
      return 0;
    }

    return k - reminder;
  }
}

// test stack

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

console.log(pt3.deref()); // Undefined behavior

// test heap

console.log("test heap");

const mem2 = new Memory(1024, { stack: 256 });

const heapPt1 = mem2.alloc(3, Int32Array);

heapPt1.change(new Int32Array([2, 1]));

console.log(heapPt1.deref());

const heapPt2 = mem2.alloc(10, Float64Array);

heapPt2.change(new Float64Array([1.2, 2, 3, 4, 5, 6]));

console.log(heapPt2.deref());

mem.free(heapPt1);

console.log(heapPt2.deref());
console.log(heapPt1.deref());

const heapPt3 = mem2.alloc(3, BigInt64Array);

heapPt3.change(new BigInt64Array([123423235678n]));

console.log(heapPt1.deref());
console.log(heapPt3.deref());
