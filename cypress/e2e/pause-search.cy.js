describe.skip('Pause Job Search', () => {
    it('pauses job search and hides status banner', () => {
      cy.visit('/dashboard');
      cy.contains('Pause Search').click();
      cy.contains('Job Search Active').should('not.exist');
      // Optionally, check for the appearance of "Activate Search" if it should appear
      // cy.contains('Activate Search');
    });
  });