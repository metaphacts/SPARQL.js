var SparqlParser = require('../sparql').Parser;

var fs = require('fs');
var { DataFactory } = require('rdf-data-factory');

var expect = require("expect");
var toEqualParsedQuery = require("../test/matchers/toEqualParsedQuery");
expect.extend({
  toEqualParsedQuery,
});

var dataFactory = new DataFactory();
var queriesPath = __dirname + '/../queries/';
var parsedQueriesPath = __dirname + '/../test/parsedQueries/';

describe('A SPARQL parser', function () {
  var parser = new SparqlParser();

  // Ensure the same blank node identifiers are used in every test
  beforeEach(function () { parser._resetBlanks(); });

  describe('in SPARQL mode', () => {
    testQueries('sparql', {});
    testQueries('sparqlstar', { mustError: true });
  });

  describe('in SPARQL* mode', () => {
    testQueries('sparql', { sparqlStar: true });
    testQueries('sparqlstar', { sparqlStar: true });
  });

  it('should throw an error on an invalid query', function () {
    var query = 'invalid', error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Parse error on line 1');
  });

  it('should throw an error on a projection of ungrouped variable', function () {
    var query = 'PREFIX : <http://www.example.org/> SELECT ?o WHERE { ?s ?p ?o } GROUP BY ?s', error = null;
    var error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Projection of ungrouped variable (?o)");
  });

  describe("with variable group checks disabled", function() {
    var parserWithoutValidation = new SparqlParser({skipUngroupedVariableCheck:true});

    // Ensure the same blank node identifiers are used in every test
    beforeEach(function () { parser._resetBlanks(); });

    it('should not throw an error on a projection of ungrouped variable', function () {
      var query = 'PREFIX : <http://www.example.org/> SELECT ?o WHERE { ?s ?p ?o } GROUP BY ?s', error = null;
      var error = null;
      try { parserWithoutValidation.parse(query); }
      catch (e) { error = e; }
      expect(error).toBeNull();
    });
  })

  it('should throw an error on a use of an ungrouped variable for a projection of an operation', function () {
    var query = 'PREFIX : <http://www.example.org/> SELECT ?o (?o + ?p AS ?c) WHERE { ?s ?p ?o } GROUP BY (?o)';
    var error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Use of ungrouped variable in projection of operation (?p)");
  });

  //Setting test to skipped. Enable this test once https://github.com/RubenVerborgh/SPARQL.js/issues/120 is resolved.
  it.skip('should not throw an ungrouped variable error when the query is valid', function () {
    var query = 'select ?s (?x as ?y) {?s ?p ?x.} group by ?s';
    var error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }
    expect(error).toBeNull();
  });

  it('should throw an error on an invalid bindscope', function () {
    var query = "PREFIX : <http://www.example.org> SELECT * WHERE {{:s :p ?o . :s :q ?o1 .} BIND((1+?o) AS ?o1)}";
    var error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Variable used to bind is already bound (?o1)");
  });

  it('should throw an error on an invalid selectscope', function () {
    var query = "SELECT (1 AS ?X ) { SELECT (2 AS ?X ) {} }";
    var error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Target id of 'AS' (?X) already used in subquery");
  });

  it('should preserve BGP and filter pattern order', function () {
    var query = 'SELECT * { ?s ?p "1" . FILTER(true) . ?s ?p "2"  }';
    var groups = parser.parse(query).where;
    expect(groups[0].type).toBe("bgp");
    expect(groups[1].type).toBe("filter");
    expect(groups[2].type).toBe("bgp");
  });

  describe('with pre-defined prefixes', function () {
    var prefixes = { a: 'ex:abc#', b: 'ex:def#' };
    var parser = new SparqlParser({ prefixes });

    it('should use those prefixes', function () {
      var query = 'SELECT * { a:a b:b "" }';
      var result_json = {subject: dataFactory.namedNode('ex:abc#a'),
      predicate: dataFactory.namedNode('ex:def#b'),
      object: dataFactory.literal("")};

      expect(parser.parse(query).where[0].triples[0]).toEqual(result_json);
    });

    it('should allow temporarily overriding prefixes', function () {
      var query = 'PREFIX a: <ex:xyz#> SELECT * { a:a b:b "" }';
      var result = {subject: dataFactory.namedNode("ex:xyz#a"),
        predicate:dataFactory.namedNode("ex:def#b"),
        object: dataFactory.literal(""),
      };
      expect(parser.parse(query).where[0].triples[0]).toEqualParsedQuery(result);

      var query2 = 'SELECT * { a:a b:b "" }';
      var result2 = {subject: dataFactory.namedNode("ex:abc#a"),
        predicate:dataFactory.namedNode("ex:def#b"),
        object: dataFactory.literal(""),
      };
      expect(parser.parse(query2).where[0].triples[0]).toEqualParsedQuery(result2);
    });

    it('should not change the original prefixes', function () {
      expect(prefixes).toEqual({ a: 'ex:abc#', b: 'ex:def#' });
    });

    it('should not take over changes to the original prefixes', function () {
      var query = 'SELECT * { a:a b:b "" }';
      var result = {subject: dataFactory.namedNode("ex:abc#a"),
        predicate: dataFactory.namedNode("ex:def#b"),
        object: dataFactory.literal("")
      };
      prefixes.a = 'ex:xyz#';

      expect(parser.parse(query).where[0].triples[0]).toEqualParsedQuery(result);
    });
  });

  describe('with pre-defined base IRI', function () {
    var parser = new SparqlParser({ baseIRI: 'http://ex.org/' });

    it('should use the base IRI', function () {
      var query = 'SELECT * { <> <#b> "" }';
      var result = {subject: dataFactory.namedNode("http://ex.org/"),
        predicate: dataFactory.namedNode("http://ex.org/#b"),
        object: dataFactory.literal("")
      };

      expect(parser.parse(query).where[0].triples[0]).toEqualParsedQuery(result);
    });

    it('should work after a previous query failed', function () {
      var badQuery = 'SELECT * { <> <#b> "" } invalid!';
      expect(() => parser.parse(badQuery)).toThrow(Error);

      var goodQuery = 'SELECT * { <> <#b> "" }';

      parser = new SparqlParser({ baseIRI: 'http://ex2.org/' });
      var result = {subject: dataFactory.namedNode("http://ex2.org/"),
        predicate: dataFactory.namedNode("http://ex2.org/#b"),
        object: dataFactory.literal("")
      };
      var data = parser.parse(goodQuery);
      expect(data.where[0].triples[0]).toEqualParsedQuery(result);
    });
  });

  it('should throw an error on relative IRIs if no base IRI is specified', function () {
    var query = 'SELECT * { <a> <b> <c> }', error = null;
    try { parser.parse(query); }
    catch (e) { error = e; }

    expect(error).not.toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot resolve relative IRI a because no base IRI was set.');
  });

  describe('with group collapsing disabled', function () {
    it('should keep explicit pattern group', function () {
      var query = 'SELECT * WHERE { { ?s ?p ?o } ?a ?b ?c }';
      var result = [
        {
          type: "group",
          patterns: [
            {
              type: "bgp",
              triples: [
                {
                  subject: dataFactory.variable("s"),
                  predicate: dataFactory.variable("p"),
                  object: dataFactory.variable("o")
                }
              ]
            }
          ]
        },
        {
          type: "bgp",
          triples: [
            {
              subject: dataFactory.variable("a"),
              predicate: dataFactory.variable("b"),
              object: dataFactory.variable("c")
            }
          ]
        }
      ];

      expect(parser.parse(query).where).toEqualParsedQuery(result);
    });

    it('should still collapse immediate union groups', function () {
      var query = 'SELECT * WHERE { { ?s ?p ?o } UNION { ?a ?b ?c } }';
      var result = '[{"type":"union","patterns":[{"type":"bgp","triples":[{"subject":{"termType":"Variable","value":"s"},"predicate":{"termType":"Variable","value":"p"},"object":{"termType":"Variable","value":"o"}}]},{"type":"bgp","triples":[{"subject":{"termType":"Variable","value":"a"},"predicate":{"termType":"Variable","value":"b"},"object":{"termType":"Variable","value":"c"}}]}]}]';

      expect(parser.parse(query).where).toEqualParsedQuery(parseJSON(result));
    });
  });

  describe('without SPARQL* support enabled', function () {
    var parser = new SparqlParser();
    const expectedErrorMessage = 'SPARQL* support is not enabled';

    it('should throw an error on RDF* triple in projection', function () {
      expect(() => parser.parse(
        'SELECT (<< <ex:s> a <ex:o> >> as ?x) WHERE { }'
      )).toThrow(expectedErrorMessage);
    });

    it('should throw an error on RDF* triple in BGP', function () {
      expect(() => parser.parse(
        'SELECT * WHERE { << ?s ?p ?o >> ?p2 ?o2 }'
      )).toThrow(expectedErrorMessage);
    });

    it('should throw an error on RDF* triple in BIND', function () {
      expect(() => parser.parse(
        'SELECT * WHERE { BIND(<< <ex:s> <ex:p> 42 >> as ?x) }'
      )).toThrow(expectedErrorMessage);
    });
  });
});

function testQueries(directory, settings) {
  var parser = new SparqlParser(settings);

  var queries = fs.readdirSync(queriesPath + directory + '/');
  queries = queries.map(function (q) { return q.replace(/\.sparql$/, ''); });
  queries.sort();

  queries.forEach(function (query) {
    var sparql = fs.readFileSync(queriesPath + directory + '/' + query + '.sparql', 'utf8');

    var parsedQueryFile = parsedQueriesPath + directory + '/' + query + '.json';
    if (settings.mustError || !fs.existsSync(parsedQueryFile)) {
      it('should error when parsing query "' + query + '"', function () {
        expect(() => parser.parse(sparql)).toThrow();
      });
    }
    else {
      it('should correctly parse query "' + query + '"', function () {
        var parsedQuery = parseJSON(fs.readFileSync(parsedQueryFile, 'utf8'));

        const parsed = parser.parse(sparql);
        expect(parsed).toEqualParsedQuery(parsedQuery);
      });
    }
  });
}
