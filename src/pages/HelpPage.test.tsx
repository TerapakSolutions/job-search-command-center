/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HelpPage, { CLASSIFICATION_GLOSSARY } from './HelpPage';
import { EMAIL_CLASSIFICATIONS } from '../../server/lib/emailClassificationTypes';

describe('HelpPage', () => {
  it('has a glossary line for exactly the classifications the pipeline emits', () => {
    expect(Object.keys(CLASSIFICATION_GLOSSARY).sort()).toEqual([...EMAIL_CLASSIFICATIONS].sort());
  });

  it('renders the quick start and every classification', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Quick start' })).toBeTruthy();
    for (const name of EMAIL_CLASSIFICATIONS) {
      expect(screen.getByText(name, { selector: 'dt' })).toBeTruthy();
    }
  });
});
