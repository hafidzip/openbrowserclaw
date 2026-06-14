// mutex.ts
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  acquire(): Promise<void> {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve); // park until released
      }
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();          // hand off to next waiter
    else this.locked = false;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}   