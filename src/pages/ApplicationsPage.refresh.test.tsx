/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplicationsPage from './ApplicationsPage';

const mockEmpty: never[] = [];
const mockRefreshData = jest.fn().mockResolvedValue(undefined);

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockEmpty,
      refreshData: mockRefreshData,
    }),
}));

describe('Applications refresh', () => {
  it('reloads applications from the server', async () => {
    render(<ApplicationsPage />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: /Refresh/ });
    fireEvent.click(button);

    expect(mockRefreshData).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
