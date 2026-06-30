import { render, waitFor } from '@testing-library/react';

jest.mock('../api/supabaseJobsClient', () => ({
  fetchJobs: jest.fn().mockResolvedValue([
    { id: 1, company: 'Company A', title: 'Engineer', status: 'queued' },
    { id: 2, company: 'Company B', title: 'Designer', status: 'completed' },
  ]),
}));

import JobsTable from './JobsTable';

describe('JobsTable', () => {
  it('renders without crashing', async () => {
    await waitFor(() => render(<JobsTable />));
  });
});
