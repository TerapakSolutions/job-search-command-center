describe.skip('Jobs Table', () => {
    it('loads and displays jobs', () => {
      cy.visit('/dashboard');
      // Adjust the selector/text below to match your table header or a job row
      cy.contains('Company Title Status'); // Table header
      // Check for at least one job row (adjust text as needed)
      cy.get('ul').find('li').should('have.length.greaterThan', 0);
    });
  });