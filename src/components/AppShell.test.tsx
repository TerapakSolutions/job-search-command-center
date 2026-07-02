import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';

describe('AppShell', () => {
  it('renders its children', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>Test Content</div>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('Test Content')).toBeTruthy();
  });

  it('renders primary navigation links', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div />
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Today/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Pipeline/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Settings/i })).toBeTruthy();
  });
});
