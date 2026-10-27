import { Injectable } from '@nestjs/common';

// Seeded violations (SC-TYPEFILE, SC-TYPE). Used by stackcrew end-to-end tests.
interface CustomerRow {
  id: string;
  fullName: string;
}

@Injectable()
export class CustomerService {
  private cache: any;

  find(id: string): CustomerRow | undefined {
    return this.cache?.[id];
  }
}
