describe('Dashboard Page', () => {
  it('loads and displays main stats', () => {
    cy.visit('/dashboard');
    cy.contains('Dashboard');
    cy.contains('Completed Applications');
    cy.contains('Jobs in Queue');
    cy.contains('Preview Applications');
  });

  it('navigates to Settings and back', () => {
    cy.visit('/dashboard');
    cy.contains('Settings').click();
    cy.url().should('include', '/settings');
    cy.contains('Settings');
    cy.contains('Dashboard').click();
    cy.url().should('include', '/dashboard');
  });
}); 