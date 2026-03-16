// src/weaviate/testFetch.ts
import { client } from './weaviate.service';

async function fetchData() {
  const result = await client.graphql
    .get()
    .withClassName('QAData')
    .withTenant('default') // ✅ Required for multi-tenancy
    .withFields('fileId question answer pageNumber')
    .do();

  console.log(JSON.stringify(result, null, 2));
}

fetchData();