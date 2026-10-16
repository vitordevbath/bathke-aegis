/**
 * Base class for domain entities. Identity, not attribute values,
 * defines equality.
 */
export abstract class Entity<TId extends string | number> {
  protected constructor(public readonly id: TId) {}

  equals(other: Entity<TId>): boolean {
    return other.constructor === this.constructor && other.id === this.id;
  }
}
