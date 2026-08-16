/**
 * Plain ASCII brand assets — the one source of truth for web and terminal.
 *
 * Usage rule (docs/design-plan.md §1): never two hive assets on one surface.
 * - comb    — the emblem, ceremony: terminal banner, landing boot, 404/empty
 * - bee     — the mark, hive alive: favicon glyph, status, empty-state companion
 * - wordmark — the logotype, stable identity: global chrome
 */

/** The hive comb emblem (hex cells + @ queen). */
export const comb = `
      ^^     .-=-=-=-.  ^^                                     
^^        (\`-=-=-=-=-\`)         ^^                           
        (\`-=-=-=-=-=-=-\`)  ^^         ^^                     
  ^^   (\`-=-=-=-=-=-=-=-\`)   ^^                            ^^
      ( \`-=-=-=-(@)-=-=-\` )      ^^                          
      (\`-=-=-=-=-=-=-=-=-\`)  ^^                              
      (\`-=-=-=-=-=-=-=-=-\`)              ^^                  
      (\`-=-=-=-=-=-=-=-=-\`)                      ^^          
      (\`-=-=-=-=-=-=-=-=-\`)  ^^                              
       (\`-=-=-=-=-=-=-=-\`)          ^^                       
        (\`-=-=-=-=-=-=-\`)  ^^                 ^^             
          (\`-=-=-=-=-\`)                                      
           \`-=-=-=-=-\`                                       
              ^^`;

/** The bee mark (body :>(|||} with flight trail). */
export const bee = `   ,-.      .' '.        .\`
   \\_/      .   .       .
:>(|||}.      .        .
   / \\  '. . ' ' . . '
   \`-'`;

/** The logotype. */
export const wordmark = "[ h i v e ]";
