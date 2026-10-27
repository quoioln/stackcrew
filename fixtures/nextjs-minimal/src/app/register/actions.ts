'use server';

// Seeded violations (SC-TYPEFILE, SC-ENV). Used by stackcrew end-to-end tests.
export interface RegisterInput {
  fullName: string;
}

export async function register(input: RegisterInput): Promise<void> {
  await fetch(`${process.env.API_URL}/customers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
