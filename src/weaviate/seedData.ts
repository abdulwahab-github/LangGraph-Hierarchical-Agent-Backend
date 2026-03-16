// src/weaviate/seedData.ts
import { client } from './weaviate.service';

async function seedData() {
  const TENANT = 'default';

  const data = [
    {
      fileId: '1',
      question: 'What is AI?',
      answer:
        'Artificial Intelligence is the simulation of human intelligence by machines.',
      pageNumber: ['3'],
    },
    {
      fileId: '2',
      question: 'What is Machine Learning?',
      answer:
        'Machine learning is a subset of AI that allows systems to learn from data.',
      pageNumber: ['5'],
    },
    {
      fileId: '3',
      question: 'What is Deep Learning?',
      answer:
        'Deep learning is a machine learning technique using multi-layered neural networks.',
      pageNumber: ['9'],
    },
  ];

  for (const item of data) {
    await client.data
      .creator()
      .withClassName('QAData')
      .withTenant(TENANT) // ✅ Required because multi-tenancy is enabled
      .withProperties(item)
      .do();
  }

  console.log('✅ Seed data inserted into tenant:', TENANT);
}

seedData();
