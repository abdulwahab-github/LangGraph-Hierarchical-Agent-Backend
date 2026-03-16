// src/weaviate/createSchema.ts
import { client } from './weaviate.service';

async function createSchema() {
  const schema = {
    class: 'QAData',
    multiTenancyConfig: { enabled: true }, // ✅ Multi-tenancy ENABLED as required
    properties: [
      {
        name: 'fileId',
        dataType: ['string'],
        indexSearchable: false,
        indexFilterable: false,
      },
      {
        name: 'question',
        dataType: ['text'],
      },
      {
        name: 'answer',
        dataType: ['text'],
      },
      {
        name: 'pageNumber',
        dataType: ['text[]'],
      },
    ],
  };

  // Delete old schema if exists
  try {
    await client.schema.classDeleter().withClassName('QAData').do();
    console.log('Old schema deleted');
  } catch (e) {
    // ignore if class doesn't exist
  }

  await client.schema.classCreator().withClass(schema).do();
  console.log('✅ Schema created with multi-tenancy ENABLED');

  // Create a default tenant for our data
  await client.schema
    .tenantsCreator('QAData', [{ name: 'default' }])
    .do();
  console.log('✅ Default tenant created');
}

createSchema();