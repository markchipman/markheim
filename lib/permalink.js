var path = require('path');
var es = require('event-stream');

var gutil = require('gulp-util');

var _ = require('lodash');
var urlTemplate = require('url-template');

module.exports = function() {
  return es.map(function(file, cb) {
    var site = file.globals.site;
    var permalink = file[site.ssg].permalink;

    if (file.type === 'posts' || (file.type === 'pages' && permalink[0] === '/')) {

      /**
       * If the permalink value begins with a slash then we use it as a template,
       * otherwise it's the name of a template and so we need to do a lookup:
       */

      var template;

      if (permalink[0] === '/' || file.type === 'pages') {
        template = permalink;
      } else {
        template = site.permalink_templates[permalink];
      }

      gutil.log('  template:', template);

      /**
       * We can cope with proper RFC 6570 format, or the colon prefixed format
       * used by Jekyll:
       */

      template = template
        .replace(/\:(\w*)/g, '{$1}')
        .replace(/\{categories\}/g, '{/categories*}');

      /**
       * Next work out the parameters that will be passed to the template. If
       * we have a post then the values will come from the post's file system
       * path:
       */

      var params = {};

      if (file.type === 'posts') {

        /**
         * If we have a post then get the date and title information from the
         * post name:
         */

        var match = file.relative.match(new RegExp(site.post_name_format));

        if (match){
          params = {
            year: match[1],
            month: match[2],
            i_month: Number(match[2]),
            day: match[3],
            i_day: Number(match[3]),
            short_year: match[1].substr(2),
            title: file.globals.page.slug || match[4],
            categories: file.globals.page.categories
          };
        }
      }

      var url = urlTemplate
        .parse(template)
        .expand(params);

      /**
       * Add 'index.html' to any URL that doesn't have a type on the end:
       */

      if (!_.endsWith(url, '.html')) {
        url += '/index.html';
      }

      /**
       * Finally, remove any duplicated slashes and save the values:
       */

      url = url.replace('//', '/');
      gutil.log('  url:', url);
      file.globals.page.url = url;
      file.path = './' + url;
    }
    cb(null, file);
  });
};