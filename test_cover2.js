const path = require('path');
const jsmediatags = require(path.join(__dirname, 'node_modules', 'jsmediatags'));

const filePath = 'E:\\MyMusic\\G-DRAGON\\KWON JI YONG\\G-DRAGON - \uBB34\uC81C (\u65E0\u9898) (Untitled, 2014).flac';

new jsmediatags.Reader(filePath)
  .setTagsToRead(['picture'])
  .read({
    onSuccess: (tag) => {
      const pic = tag.tags.picture;
      const data = pic.data;
      console.log('data type:', typeof data);
      console.log('is Array:', Array.isArray(data));
      console.log('is Uint8Array:', data instanceof Uint8Array);
      console.log('is Buffer:', Buffer.isBuffer(data));
      console.log('constructor name:', data.constructor && data.constructor.name);
      console.log('length:', data.length);
      console.log('has buffer:', !!data.buffer);
      console.log('buffer type:', data.buffer && typeof data.buffer);
      console.log('buffer constructor:', data.buffer && data.buffer.constructor && data.buffer.constructor.name);
      
      // Try to convert
      if (Buffer.isBuffer(data)) {
        console.log('It is a Buffer!');
      } else if (data instanceof Uint8Array) {
        const b = Buffer.from(data);
        console.log('Buffer from Uint8Array length:', b.length);
      } else if (Array.isArray(data)) {
        const b = Buffer.from(data);
        console.log('Buffer from Array length:', b.length);
      }
      
      // Try first few bytes
      const firstBytes = [];
      for (let i = 0; i < Math.min(8, data.length); i++) {
        firstBytes.push(data[i]);
      }
      console.log('first bytes:', firstBytes.map(b => b.toString(16)).join(' '));
    },
    onError: (err) => {
      console.log('Error:', err.type, err.info);
    }
  });
