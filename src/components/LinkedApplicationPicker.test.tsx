/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LinkedApplicationPicker from './LinkedApplicationPicker';
import * as client from '../api/emailAutomationClient';

jest.mock('../api/emailAutomationClient', () => ({
  linkEmailToApplication: jest.fn().mockResolvedValue({ linkedApplicationId: null }),
}));

const mockLink = jest.mocked(client.linkEmailToApplication);

const apps = [
  { id: 'app-2', company: 'Zeta Co', roleTitle: 'Architect' },
  { id: 'app-1', company: 'Client Co', roleTitle: 'Engineering Manager' },
];

describe('LinkedApplicationPicker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists every application, sorted by company, with a Not linked option', () => {
    render(
      <LinkedApplicationPicker emailId="e1" applications={apps} linkedApplicationId={null} onChanged={jest.fn()} />,
    );
    const options = Array.from(
      (screen.getByLabelText('Linked application') as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options).toEqual([
      'Not linked',
      'Client Co — Engineering Manager',
      'Zeta Co — Architect',
    ]);
  });

  it('links the chosen application, then tells the page to reload', async () => {
    const onChanged = jest.fn();
    render(
      <LinkedApplicationPicker emailId="e1" applications={apps} linkedApplicationId={null} onChanged={onChanged} />,
    );
    fireEvent.change(screen.getByLabelText('Linked application'), { target: { value: 'app-1' } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockLink).toHaveBeenCalledWith('e1', 'app-1');
  });

  it('shows the current link and unlinks it', async () => {
    const onChanged = jest.fn();
    render(
      <LinkedApplicationPicker emailId="e1" applications={apps} linkedApplicationId="app-2" onChanged={onChanged} />,
    );
    expect((screen.getByLabelText('Linked application') as HTMLSelectElement).value).toBe('app-2');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockLink).toHaveBeenCalledWith('e1', null);
  });

  it('has no Unlink button when nothing is linked', () => {
    render(
      <LinkedApplicationPicker emailId="e1" applications={apps} linkedApplicationId={null} onChanged={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });
});
