describe.skip('Job Search Activation', () => {
  it('activates job search and shows status banner', () => {
    cy.visit('/dashboard');
    cy.contains('Activate Search').click();
    cy.contains('Job Search Active — our AI engine is busy!');
  });
}); 