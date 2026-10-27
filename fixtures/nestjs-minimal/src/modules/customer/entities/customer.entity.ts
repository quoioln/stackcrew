import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Seeded: an entity that does not extend the project's base entity. Used by stackcrew end-to-end tests.
@Entity()
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  fullName!: string;
}
