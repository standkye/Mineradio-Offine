const path = require('path');
const jsmediatags = require(path.join(__dirname, 'node_modules', 'jsmediatags'));

const filePath = 'E:\\MyMusic\\G-DRAGON\\KWON JI YONG\\G-DRAGON - \uBB34\uC81C (\u65E0\u9898) (Untitled, 2014).flac';
console.log('Testing file:', filePath);

new jsmediatags.Reader(filePath)
  .setTagsToRead(['title', 'artist', 'album', 'picture'])
  .read({
    onSuccess: (tag) => {
      const tags = tag.tags || {};
      console.log('title:', tags.title);
      console.log('artist:', tags.artist);
      console.log('album:', tags.album);
      console.log('has picture:', !!tags.picture);
      if (tags.picture) {
        console.log('picture format:', tags.picture.format);
        console.log('picture type:', tags.picture.type);
        const data = tags.picture.data;
        console.log('data type:', typeof data, 'length:', data && data.length || (data && data.byteLength));
      }
    },
    onError: (err) => {
      console.log('Error type:', err.type);
      console.log('Error info:', err.info);
    }
  });
