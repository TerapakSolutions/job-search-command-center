import { render } from '@testing-library/react';
import * as store from '../store/useAppStore';
import { QueueListPanel } from './QueueListPanel';

describe('QueueListPanel', () => {
  beforeAll(() => {
    jest.spyOn(store, 'useAppStore').mockImplementation((selector) =>
      selector({
        queue: [
          { id: 1, title: 'Job 1', company: 'Company A' },
          { id: 2, title: 'Job 2', company: 'Company B' },
        ],
      } as unknown as ReturnType<typeof store.useAppStore.getState>),
    );
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('renders without crashing', () => {
    render(<QueueListPanel />);
  });
});
