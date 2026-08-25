import Big from 'big.js';

export class Money {
  private readonly amount: Big;

  // Constructor is private to enforce using factory methods
  private constructor(amount: Big | number | string) {
    this.amount = new Big(amount);
  }

  static from(amount: number | string): Money {
    return new Money(amount);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return new Money(this.amount.plus(other.amount));
  }

  subtract(other: Money): Money {
    return new Money(this.amount.minus(other.amount));
  }

  equals(other: Money): boolean {
    return this.amount.eq(other.amount);
  }

  greaterThan(other: Money): boolean {
    return this.amount.gt(other.amount);
  }

  lessThan(other: Money): boolean {
    return this.amount.lt(other.amount);
  }

  isZero(): boolean {
    return this.amount.eq(0);
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  toString(decimals: number = 2): string {
    return this.amount.toFixed(decimals);
  }
}
