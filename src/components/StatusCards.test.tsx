import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusCards from './StatusCards';

describe('StatusCards', () => {
  it('renders without crashing', () => {
    const stats = [{ label: 'Test', value: 1, link: '/test' }];
    render(
      <MemoryRouter>
        <StatusCards stats={stats} />
      </MemoryRouter>,
    );
  });
});
