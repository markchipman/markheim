var path = require('path');
var fs = require('fs');

var _ = require('lodash');

var es = require('event-stream');
var yaml = require('js-yaml');

var gulp = require('gulp');
var gutil = require('gulp-util');

var merge = require('deepmerge');
var frontMatter = require('./lib/front-matter');
var permalink = require('./lib/permalink');
var templatize = require('./lib/templatize');

/**
 * First load the Markheim configuration file:
 */

var config;

try {
  config = yaml.safeLoad(
    fs.readFileSync(path.join(__dirname, 'config', 'default.yml'), 'utf8')
  );
} catch (e) {
  throw new gutil.PluginError('Markheim', e);
}


/**
 * Now get the default Markheim configuration settings for this SSG:
 */

try {
  config = merge(
    config,
    yaml.safeLoad(
      fs.readFileSync(
        path.join(__dirname, 'config', config.ssg + '.yml'),
        'utf8'
      )
    )
  );
} catch (e) {
  throw new gutil.PluginError('Markheim', e);
}


/**
 * Now get the default SSG configuration settings. These are different from
 * the settings from the previous step, since they will be determined by the
 * SSG itself:
 */

try {
  config = merge(
    config,
    yaml.safeLoad(
      fs.readFileSync(
        path.join(__dirname, 'defaults', config.ssg + '.yaml'),
        'utf8'
      )
    )
  );
} catch (e) {
  throw new gutil.PluginError('Markheim', e);
}


/**
 * The root directory is the directory where the command is run, and all other
 * paths in the config are specified relative to that:
 */

var paths = {};

paths.root = process.cwd();


/**
 * Now we can get the user configuration settings:
 */

var userConfigFile = path.join(paths.root, config.config);

console.log('Configuration file:', userConfigFile);

try {
  config = merge(
    config,
    yaml.safeLoad(fs.readFileSync(userConfigFile, 'utf8'))
  );
} catch (e) {
  console.warn(' no configuration file present');
}

paths.source = path.join(paths.root, config.source);
paths.destination = path.join(paths.root, config.destination);
paths.plugins = path.join(paths.root, config.plugins);
paths.layouts = path.join(paths.root, config.layouts);
paths.includes = config.includes;
paths.sass = path.join(paths.root, config.sass.sass_dir);
paths.posts = path.join(paths.root, config.posts);
paths.drafts = path.join(paths.root, config.drafts);

config.paths = paths;

console.log('            Source:', paths.source);
console.log('       Destination:', paths.destination);

/**
 * Set up the source descriptions with the source and any directories
 * to exclude:
 */

var src = [];

var include = config.include;
var exclude = config.exclude;

exclude.push(userConfigFile);
exclude.push(paths.plugins);
exclude.push(paths.layouts);
exclude.push(paths.includes);
exclude.push(paths.sass);
exclude.push(paths.destination);
exclude.push(paths.drafts);

src.push(path.join(paths.source, '**', '*'));

include.map(function(directory) {
  src.push(directory);
  src.push(path.join(directory, '**', '*'));
});

exclude.map(function(directoryList) {
  if (!Array.isArray(directoryList)) {
    directoryList = [directoryList];
  }
  directoryList.forEach(function(directory) {
    src.push('!' + directory);
    src.push('!' + path.join(directory, '**', '*'));
  })
});

/**
 * Similarly set up the 'clean' description with any directories to
 * exclude, i.e., to not delete:
 */

include = [path.join(paths.destination, '**', '*')];
exclude = [];

config.keep_files.map(function(file) {
    return path.join(paths.destination, file);
  })
  .map(function(directory) {
    exclude.push('!' + directory);
    exclude.push('!' + path.join(directory, '**', '*'));
  });

var clean = include.concat(exclude);


/**
 * C L E A N
 * =========
 */

var del = require('del');

gulp.task('clean', function(cb) {
  return del(clean, cb);
});


/**
 * P R E P R O C E S S
 * ===================
 *
 * Build a map of the site by running through each document and collecting
 * its data, path, title, type, etc.
 */

var shared = {
  config: config,
  site: {
    time: new Date(),
    pages: [],
    posts: [],
    related_posts: [],
    static_files: [],
    html_pages: [],
    collections: [],
    data: [],
    documents: [],
    categories: {},
    tags: {}
  }
};
var site = shared.site;

var cache = [];

var getExcerpt = function(config, content) {
  var excerpt_separator = config.excerpt_separator;

  if (excerpt_separator) {
    var re = new RegExp('([^]*)' + excerpt_separator);
    var result = re.exec(content);

    if (result && result[1]) {
      return result[1];
    }
  }
};


/**
 * The output of the preprocess step is a map of the site and metadata for
 * each page, but no content has yet been processed:
 */

gulp.task('preprocess', function(/*callback*/) {
  console.log('      Preprocessing...');
  var setType = require('./lib/set-type');

  return gulp.src(src, {allowEmpty: true})

    /**
     * First work out the type of the document and collect its values:
     */

    .pipe(setType(config))
    .pipe(frontMatter.parse())
    .pipe(frontMatter.collate(config))


    /**
     * Now set the page variables:
     */

    .pipe(es.map(function(file, cb) {
      var fm = file.frontMatter;

      if (fm) {
        var content = String(file.contents);

        file.page = merge({
          content: content,
          excerpt: getExcerpt(config, content),
          url: '',
          id: '',
          path: file.path, //fm.path will take priority
          next: '',
          prev: ''
        }, fm);
      }
      cb(null, file);
    }))

    .pipe(permalink(config))

    /**
     * Save the document, ready for further processing:
     */

    .pipe(es.map(function(file, cb) {
      if (file.page) {
        cache.push(file);
        cb(null, file);
      } else {
        cb();
      }
    }))

    /**
     * Now save the document's details to the appropriate collection:
     */

    .pipe(es.map(function(file, cb) {
      var page = file.page;

      if (page) {
        if (page.categories && Array.isArray(page.categories)) {
          page.categories.forEach(function (category) {
            site.categories[category] = site.categories[category] || [];
            site.categories[category].push(page);
          });
        }

        if (page.tags && Array.isArray(page.tags)) {
          page.tags.forEach(function (tag) {
            site.tags[tag] = site.tags[tag] || [];
            site.tags[tag].push(page);
          });
        }

        if (file.type === 'posts') {
          site.posts.push(page);
        }
        else if (file.type === 'pages') {
          site.pages.push(page);
        } else {
          console.log('Other type:', file.type, file.relative);
        }
      }
      cb(null, file);
    }));
});


/**
 * P O S T S
 * =========
 */

var highland = require('highland');
var md = require('markdown-it')({ html: true });

gulp.task('posts', gulp.series('preprocess', function() {
  console.log('      Generating...');

  return highland(cache)

    /**
     * If the file is a Markdown file then process accordingly:
     */

    .map(function(file) {
      var markdownExtensions = config.markdown_ext;
      var extname = path.extname(file.path).substring(1);

      if (markdownExtensions.indexOf(extname) !== -1) {
        file.contents = new Buffer(md.render(String(file.contents)));
      }
      return file;
    })

    /**
     * If the file is a SASS file then process accordingly:
     */

    .map(function(file) {
      var extname = path.extname(file.path).substring(1);
      if (extname === 'scss') {
        var sass = require('node-sass');
        var content = String(file.contents);
        var result = sass.renderSync({
          data: content,
          includePaths: [shared.config.paths.sass]
        });
        file.contents = result.css;
        file.path = gutil.replaceExtension(file.path, '.css');
      }
      return file;
    })
    .pipe(templatize(shared))

    .pipe(frontMatter.parse())
    .pipe(frontMatter.collate(config))


    /**
     * Now set the page variables:
     */

    .pipe(es.map(function(file, cb) {
      var fm = file.frontMatter;

      if (fm) {
        var content = String(file.contents);

        file.page = merge(file.page, {
          content: content,
          comments: fm.comments,
          title: fm.title,
          excerpt: getExcerpt(config, content),
          url: '',
          date: fm.date,
          id: '',
          categories: fm.categories,
          tags: fm.tags,
          path: fm.path || file.path,
          next: '',
          prev: ''
        });
      }
      cb(null, file);
    }))
    .pipe(templatize(shared))

    .pipe(es.map(function(file, cb) {
      var page = file.page;

      if (page && page.url) {
        file.path = '.' + file.page.url;

        /**
         * Add 'index.html' to any URL that doesn't have a type on the end:
         */

        if (_.endsWith(file.path, '/')) {
          file.path += 'index.html';
        }
      } else {
        console.log('Didn\'t map url:', file.path, file.type);
      }
      return cb(null, file);
    }))
    .pipe(gulp.dest(path.join(paths.destination, config.baseurl)))
    ;
}));


/**
 * B U I L D
 * =========
 */

gulp.task('build', gulp.parallel('posts'));


/**
 * S E R V E
 * =========
 */

gulp.task('serve', gulp.series('build', function() {
  var browserSync = require('browser-sync').create();

  browserSync.init({
    server: {
      baseDir: paths.destination
    },
    port: config.port,
    ui: {
      port: config.port + 1
    },

    /**
     * Watch for changes to any of our files:
     */

    files: paths.destination,
    startPath: config.baseurl
  });
}));


/**
 * D R Y R U N
 * ===========
 */

gulp.task('dryrun', gulp.series('preprocess', function(cb) {
  console.log(config);
  // console.log(shared);
  // console.log(paths);
  // console.log(src);
  // console.log(shared.site);
  // console.log(shared.site.posts);
  // console.log(shared.site.pages);
  cb();
}));


/**
 * P U B L I S H
 * =============
 */

var awspublish = require('gulp-awspublish');

gulp.task('publish', gulp.series('build', function() {

  /**
   * Create a new publisher using S3 options as described at:
   *
   * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property
   */

  var publisher = awspublish.create({
    params: {
      Bucket: process.env.AWS_BUCKET
    },
    region: process.env.AWS_DEFAULT_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  });

  /**
   * Process whatever is in the output directory:
   */

  return gulp.src(path.join(paths.destination, config.baseurl, '**/*'), {allowEmpty: true})

    /**
     * Publisher will add Content-Length, Content-Type and headers specified above
     * If not specified it will set x-amz-acl to public-read by default
     */

    .pipe(publisher.publish())

    /**
     * Create a cache file to speed up consecutive uploads:
     */

    .pipe(publisher.cache())

    /**
     * Sync with S3 bucket, which means that files that are not present locally will
     * be removed from the bucket:
     */

    .pipe(publisher.sync())

    /**
     * Log activity:
     */

    .pipe(awspublish.reporter());
}));
