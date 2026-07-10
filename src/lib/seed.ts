import db from './db';
import { v4 as uuidv4 } from 'uuid';

export async function seedDatabase() {
  const count = await db.consumers.count();
  
  if (count === 0) {
    console.log('Seeding mock consumers...');
    
    const mockConsumers = [];
    for (let i = 1; i <= 100; i++) {
      mockConsumers.push({
        id: uuidv4(),
        consumer_number: `600${i.toString().padStart(4, '0')}`,
        consumer_name: `Test Consumer ${i}`,
        mobile: `98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
        address: `${i} Main Street, Area ${i % 5}, City`,
        verification_status: 'Not Collected' as const,
        created_at: new Date().toISOString()
      });
    }
    
    await db.consumers.bulkAdd(mockConsumers);
    console.log('Seeded 100 mock consumers');
  } else {
    console.log('Database already has data. Skipping seed.');
  }
}
