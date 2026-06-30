describe('Queue List Panel', () => {
  it('shows jobs in the queue', () => {
    cy.visit('/dashboard');
    // Adjust the selector/text below to match your panel header or a job row
    cy.contains('Jobs in Queue'); // Panel header
    // Optionally, check for a job row if you expect jobs to be present
    // cy.get('.queue-list-panel-selector').find('li').should('have.length.greaterThan', 0);
  });
});