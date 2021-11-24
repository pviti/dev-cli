import * as CloudFront from 'aws-sdk/clients/cloudfront';
import * as S3 from 'aws-sdk/clients/s3';
export declare namespace upload {
    interface Options {
        localFile: string;
        s3Params: {
            Bucket: string;
            Key: string;
        };
    }
}
declare const _default: {
    readonly cloudfront: {
        createCloudfrontInvalidation: (options: CloudFront.Types.CreateInvalidationRequest) => Promise<void>;
    };
    readonly s3: {
        uploadFile: (local: string, options: S3.Types.PutObjectRequest) => Promise<void>;
        headObject: (options: S3.Types.HeadObjectRequest) => Promise<S3.HeadObjectOutput>;
    };
};
export default _default;
