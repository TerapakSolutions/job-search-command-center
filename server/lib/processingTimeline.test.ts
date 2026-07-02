/** @jest-environment node */
import { ProcessingTimelineBuilder } from './processingTimeline.js';

describe('ProcessingTimelineBuilder', () => {
  it('records success steps in order', () => {
    const builder = new ProcessingTimelineBuilder();
    builder.complete('received', 'Email received', '2026-07-01T09:00:00.000Z');
    builder.complete('classified', 'Classified as Application Confirmation', '2026-07-01T09:01:00.000Z');
    builder.complete('processing_completed', 'Done', '2026-07-01T09:02:00.000Z');

    const parsed = ProcessingTimelineBuilder.parse(builder.toJson());
    expect(parsed?.steps).toHaveLength(3);
    expect(parsed?.steps[0].status).toBe('completed');
    expect(parsed?.steps[2].step).toBe('processing_completed');
  });

  it('records failure with error message', () => {
    const builder = new ProcessingTimelineBuilder();
    builder.fail(
      'processing_failed',
      'Processing failed',
      'No matching user found',
      '2026-07-01T09:00:00.000Z',
    );

    const parsed = ProcessingTimelineBuilder.parse(builder.toJson());
    expect(parsed?.steps[0].status).toBe('failed');
    expect(parsed?.steps[0].error).toMatch(/No matching user/i);
  });
});
